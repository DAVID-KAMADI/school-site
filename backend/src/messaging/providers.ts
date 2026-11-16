/**
 * The two ways the site sends messages: SMS through Africa's Talking, and email through any SMTP
 * server (Gmail / Google Workspace, Microsoft 365, the hosting company's mail, etc.).
 */
import { createTransport } from 'nodemailer';

/**
 * A phone number in international form, "+2547XXXXXXXX", or null if it does not look like one.
 * Accepts Kenyan numbers as people write them (0712 345 678, 712345678, 254712345678, +254 712 345 678)
 * and other countries' numbers that already start with +.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.startsWith('+')) return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

/** How many SMS a message costs: 160 characters for one, 153 for each part of a longer one (GSM-7). */
export function smsParts(text: string): number {
  // Characters outside the basic SMS alphabet (e.g. emoji, curly quotes) switch to 70 / 67 per part.
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà€]/.test(text);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

export interface SmsSettings {
  /** "sandbox" for testing in Africa's Talking's simulator; your app's username when live. */
  username: string;
  apiKey: string;
  /** Approved sender ID (alphanumeric, e.g. "RCMRD") or short code; empty uses Africa's Talking's default. */
  senderId: string;
  environment: 'sandbox' | 'live';
}

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  providerStatus: string | null;
  cost: string | null;
  error: string | null;
}

/** Africa's Talking statuses that mean the message was accepted (Processed, Sent, Queued). */
const AT_OK = new Set([100, 101, 102]);

/** Plain-English reasons for Africa's Talking's refusal codes. */
const AT_REASONS: Record<number, string> = {
  401: 'Held by Africa’s Talking for review (RiskHold).',
  402: 'The sender ID is not approved for this account.',
  403: 'The phone number is not valid.',
  404: 'This kind of number cannot receive SMS.',
  405: 'Not enough SMS credit on the Africa’s Talking account. Top up and try again.',
  406: 'The number has blocked messages from this sender.',
  407: 'The message could not be routed to this network.',
  409: 'The number is on the Do Not Disturb list for promotional messages.',
  500: 'Africa’s Talking had an internal error. Try again shortly.',
  501: 'The mobile network’s gateway had an error. Try again shortly.',
  502: 'The mobile network’s gateway refused the message.',
};

/** Sends one SMS through Africa's Talking (https://developers.africastalking.com/docs/sms/sending). */
export async function sendSms(settings: SmsSettings, to: string, message: string): Promise<SendResult> {
  const host = settings.environment === 'live' ? 'api.africastalking.com' : 'api.sandbox.africastalking.com';
  const body = new URLSearchParams({ username: settings.username, to, message });
  if (settings.senderId) body.set('from', settings.senderId);
  let res: Response;
  try {
    res = await fetch(`https://${host}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey: settings.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return failure(`Could not reach Africa’s Talking (${(err as Error).message}). Check the server’s internet connection.`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403)
    return failure(
      `Africa’s Talking refused the username or API key (${res.status}). ${
        settings.environment === 'sandbox'
          ? 'In sandbox mode the username must be "sandbox" and the key must be the sandbox app’s key.'
          : 'Check that they belong to your live app, not the sandbox.'
      }`,
    );
  if (!res.ok) return failure(`Africa’s Talking answered ${res.status}: ${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text) as {
      SMSMessageData?: {
        Message?: string;
        Recipients?: { statusCode: number; status: string; messageId?: string; cost?: string; number?: string }[];
      };
    };
    const r = data.SMSMessageData?.Recipients?.[0];
    if (!r) return failure(data.SMSMessageData?.Message || 'Africa’s Talking did not accept the message.');
    const ok = AT_OK.has(Number(r.statusCode));
    return {
      ok,
      providerMessageId: r.messageId && r.messageId !== 'None' ? r.messageId : null,
      providerStatus: r.status ?? null,
      cost: r.cost && r.cost !== '0' ? r.cost : null,
      error: ok ? null : (AT_REASONS[Number(r.statusCode)] ?? `Refused: ${r.status} (${r.statusCode}).`),
    };
  } catch {
    return failure(`Unexpected answer from Africa’s Talking: ${text.slice(0, 200)}`);
  }
}

export interface EmailSettings {
  host: string;
  port: number;
  /** tls: encrypted from the start (usually port 465). starttls: upgraded (usually 587). none: not encrypted. */
  security: 'tls' | 'starttls' | 'none';
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  /** Where replies go, e.g. admissions@…; empty uses the From address. */
  replyTo: string;
}

/** Sends one email. The text is sent as plain text and as simple HTML (paragraphs and links). */
export async function sendEmail(settings: EmailSettings, to: string, subject: string, text: string): Promise<SendResult> {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    ignoreTLS: settings.security === 'none',
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transport.sendMail({
      from: { name: settings.fromName || settings.fromEmail, address: settings.fromEmail },
      replyTo: settings.replyTo || undefined,
      to,
      subject,
      text,
      html: toHtml(text),
    });
    if (info.rejected?.length) return failure(`The mail server refused ${to}.`);
    return { ok: true, providerMessageId: info.messageId ?? null, providerStatus: info.response?.slice(0, 60) ?? null, cost: null, error: null };
  } catch (err) {
    return failure(emailError(err as Error & { code?: string; responseCode?: number }));
  } finally {
    transport.close();
  }
}

function emailError(err: Error & { code?: string; responseCode?: number }): string {
  if (err.code === 'EAUTH')
    return 'The mail server refused the username or password. For Gmail or Microsoft 365, use an app password.';
  if (err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET')
    return `Could not connect to the mail server (${err.message}). Check the server name, port and security setting.`;
  if (err.code === 'EENVELOPE') return `The mail server refused the sender or recipient address (${err.message}).`;
  return err.message.slice(0, 300);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function toHtml(text: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>').replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)}</p>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2027">${paragraphs}</div>`;
}

const failure = (error: string): SendResult => ({ ok: false, providerMessageId: null, providerStatus: null, cost: null, error });
