import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { authConfig } from '../config/auth.config.js';
import { SecretBox } from '../identity/totp.js';
import { MessageLog, type MessageChannel, type MessagePurpose } from './message-log.entity.js';
import {
  type EmailSettings,
  normalisePhone,
  sendEmail,
  sendSms,
  type SendResult,
  type SmsSettings,
} from './providers.js';

/** Kept in site_settings, group "messaging" (never on the Site settings page or sent to visitors). */
const SMS_KEY = 'messaging.sms';
const EMAIL_KEY = 'messaging.email';

/** Stored form: the secret is encrypted (AES-256-GCM with TOTP_ENCRYPTION_KEY). */
type Stored<T, S extends keyof T> = Omit<T, S> & { [K in S as `${K & string}Sealed`]: string | null };

const SMS_DEFAULTS: Stored<SmsSettings, 'apiKey'> = { username: 'sandbox', apiKeySealed: null, senderId: '', environment: 'sandbox' };
const EMAIL_DEFAULTS: Stored<EmailSettings, 'password'> = {
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  passwordSealed: null,
  fromName: '',
  fromEmail: '',
  replyTo: '',
};

/** What the admin sees: never the secret itself, only whether it is set and its last characters. */
export interface SettingsView {
  sms: Omit<SmsSettings, 'apiKey'> & { apiKeySet: boolean; apiKeyHint: string | null; ready: boolean };
  email: Omit<EmailSettings, 'password'> & { passwordSet: boolean; ready: boolean };
}

export interface SendMeta {
  purpose: MessagePurpose;
  sentById: number | null;
  recipientUserId?: number | null;
  applicationId?: number | null;
  /** What to keep in the message log instead of the text sent (e.g. with a reset link removed). */
  loggedText?: string;
}

/** SMS and email: the provider settings, sending, and the message log. */
@Injectable()
export class MessagingService {
  private readonly box = new SecretBox(authConfig().totpEncryptionKey);

  constructor(
    @InjectRepository(SiteSetting) private readonly settings: Repository<SiteSetting>,
    @InjectRepository(MessageLog) private readonly log: Repository<MessageLog>,
    private readonly audit: AuditService,
  ) {}

  private async read<T>(key: string, defaults: T): Promise<T> {
    const row = await this.settings.findOneBy({ key });
    return { ...defaults, ...((row?.value as Partial<T> | null) ?? {}) };
  }

  private async write(key: string, value: object, userId: number, description: string) {
    await this.settings.upsert(
      { key, groupName: 'messaging', value, description, updatedBy: { id: userId } },
      ['key'],
    );
  }

  private open(sealed: string | null): string {
    if (!sealed) return '';
    try {
      return this.box.decrypt(sealed);
    } catch {
      return ''; // TOTP_ENCRYPTION_KEY changed: the secret has to be entered again
    }
  }

  async smsSettings(): Promise<SmsSettings> {
    const s = await this.read(SMS_KEY, SMS_DEFAULTS);
    return { username: s.username, apiKey: this.open(s.apiKeySealed), senderId: s.senderId, environment: s.environment };
  }

  async emailSettings(): Promise<EmailSettings> {
    const e = await this.read(EMAIL_KEY, EMAIL_DEFAULTS);
    const { passwordSealed, ...rest } = e;
    return { ...rest, password: this.open(passwordSealed) };
  }

  async view(): Promise<SettingsView> {
    const sms = await this.smsSettings();
    const email = await this.emailSettings();
    const { apiKey, ...smsRest } = sms;
    const { password, ...emailRest } = email;
    return {
      sms: { ...smsRest, apiKeySet: !!apiKey, apiKeyHint: apiKey ? apiKey.slice(-4) : null, ready: smsReady(sms) },
      email: { ...emailRest, passwordSet: !!password, ready: emailReady(email) },
    };
  }

  /** A secret left empty keeps the saved one. */
  async saveSms(input: Partial<SmsSettings>, userId: number, ip: string | null) {
    const current = await this.read(SMS_KEY, SMS_DEFAULTS);
    const environment = input.environment === 'live' ? 'live' : 'sandbox';
    const username = (input.username ?? current.username).trim();
    const senderId = (input.senderId ?? current.senderId).trim();
    if (!username) throw new BadRequestException('Enter the Africa’s Talking username ("sandbox" when testing).');
    if (environment === 'sandbox' && username !== 'sandbox')
      throw new BadRequestException('In sandbox mode the username is always "sandbox".');
    if (senderId && !/^[A-Za-z0-9 ]{1,11}$|^\d{3,8}$/.test(senderId))
      throw new BadRequestException('A sender ID is up to 11 letters and digits, or a short code.');
    const apiKey = input.apiKey?.trim();
    await this.write(
      SMS_KEY,
      {
        username,
        senderId,
        environment,
        apiKeySealed: apiKey ? this.box.encrypt(apiKey) : current.apiKeySealed,
      },
      userId,
      'Africa’s Talking SMS settings (API key encrypted)',
    );
    await this.audit.record({
      action: 'messaging.sms_settings',
      userId,
      entityType: 'setting',
      entityId: SMS_KEY,
      details: { username, senderId, environment, apiKeyChanged: !!apiKey },
      ipAddress: ip,
    });
    return this.view();
  }

  async saveEmail(input: Partial<EmailSettings>, userId: number, ip: string | null) {
    const current = await this.read(EMAIL_KEY, EMAIL_DEFAULTS);
    const next = {
      host: (input.host ?? current.host).trim(),
      port: Number(input.port ?? current.port),
      security: (['tls', 'starttls', 'none'] as const).includes(input.security as 'tls') ? input.security! : current.security,
      username: (input.username ?? current.username).trim(),
      fromName: (input.fromName ?? current.fromName).trim(),
      fromEmail: (input.fromEmail ?? current.fromEmail).trim(),
      replyTo: (input.replyTo ?? current.replyTo).trim(),
    };
    if (next.host && !/^[A-Za-z0-9.-]+$/.test(next.host)) throw new BadRequestException('Enter the mail server name, e.g. smtp.gmail.com.');
    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new BadRequestException('Enter a valid port (usually 587 or 465).');
    const emailOk = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    if (!emailOk(next.fromEmail) || !emailOk(next.replyTo)) throw new BadRequestException('Enter full email addresses.');
    const password = input.password?.trim();
    await this.write(
      EMAIL_KEY,
      { ...next, passwordSealed: password ? this.box.encrypt(password) : current.passwordSealed },
      userId,
      'Email (SMTP) settings (password encrypted)',
    );
    await this.audit.record({
      action: 'messaging.email_settings',
      userId,
      entityType: 'setting',
      entityId: EMAIL_KEY,
      details: { host: next.host, port: next.port, security: next.security, fromEmail: next.fromEmail, passwordChanged: !!password },
      ipAddress: ip,
    });
    return this.view();
  }

  /** Sends one SMS and logs it. `to` may be written any common way; it is normalised first. */
  async sms(to: string, text: string, meta: SendMeta): Promise<SendResult & { recipient: string }> {
    const settings = await this.smsSettings();
    const phone = normalisePhone(to);
    let result: SendResult;
    if (!smsReady(settings)) result = fail('SMS is not set up yet: add the Africa’s Talking details under SMS & email.');
    else if (!phone) result = fail(`"${to}" is not a phone number the site can send to.`);
    else result = await sendSms(settings, phone, text);
    await this.record('sms', phone ?? to, null, text, result, meta);
    return { ...result, recipient: phone ?? to };
  }

  async email(to: string, subject: string, text: string, meta: SendMeta): Promise<SendResult & { recipient: string }> {
    const settings = await this.emailSettings();
    let result: SendResult;
    if (!emailReady(settings)) result = fail('Email is not set up yet: add the mail server details under SMS & email.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) result = fail(`"${to}" is not an email address.`);
    else result = await sendEmail(settings, to, subject, text);
    await this.record('email', to, subject, meta.loggedText ?? text, result, meta);
    return { ...result, recipient: to };
  }

  private async record(
    channel: MessageChannel,
    recipient: string,
    subject: string | null,
    body: string,
    r: SendResult,
    meta: SendMeta,
  ) {
    await this.log.insert({
      channel,
      purpose: meta.purpose,
      recipient: recipient.slice(0, 200),
      subject: subject?.slice(0, 200) ?? null,
      body,
      status: r.ok ? 'sent' : 'failed',
      providerMessageId: r.providerMessageId?.slice(0, 120) ?? null,
      providerStatus: r.providerStatus?.slice(0, 60) ?? null,
      cost: r.cost?.slice(0, 30) ?? null,
      error: r.error?.slice(0, 500) ?? null,
      recipientUser: meta.recipientUserId ? { id: meta.recipientUserId } : null,
      application: meta.applicationId ? { id: meta.applicationId } : null,
      sentBy: meta.sentById ? { id: meta.sentById } : null,
    });
  }

  /** Newest first, for the message history. */
  async history(limit = 200) {
    const rows = await this.log.find({
      relations: { recipientUser: true, sentBy: true, application: true },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      channel: r.channel,
      purpose: r.purpose,
      recipient: r.recipient,
      recipientName: r.recipientUser?.fullName ?? null,
      applicationId: r.application?.id ?? null,
      subject: r.subject,
      body: r.body,
      status: r.status,
      providerStatus: r.providerStatus,
      cost: r.cost,
      error: r.error,
      sentBy: r.sentBy?.fullName ?? null,
    }));
  }
}

const smsReady = (s: SmsSettings) => !!(s.username && s.apiKey);
const emailReady = (e: EmailSettings) => !!(e.host && e.fromEmail);
const fail = (error: string): SendResult => ({ ok: false, providerMessageId: null, providerStatus: null, cost: null, error });
