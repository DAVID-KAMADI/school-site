import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ApplicationsService } from '../admissions/applications.service.js';
import { ApplicationEvent } from '../admissions/entities/application-event.entity.js';
import { DocumentType } from '../admissions/entities/document-type.entity.js';
import { Application, ApplicationStatus } from '../admissions/entities/application.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { AccountType, User, UserStatus } from '../identity/entities/user.entity.js';
import { MessageLog } from './message-log.entity.js';
import { MessagingService } from './messaging.service.js';
import { normalisePhone } from './providers.js';

/**
 * draft: started an application but not submitted it.
 * info_requested: asked for more information and not yet sent it.
 * not_started: created an account but never started an application.
 */
export type FollowUpStage = 'draft' | 'info_requested' | 'not_started';

export interface FollowUpPerson {
  userId: number;
  applicationId: number | null;
  fullName: string;
  email: string;
  phone: string | null;
  programme: string | null;
  intake: string | null;
  intakeClosesAt: Date | null;
  /** Sections done out of all of them (programme, personal details…, documents); null without an application. */
  progress: { done: number; total: number; missing: string[] } | null;
  lastActivityAt: Date;
  lastFollowUpAt: Date | null;
  followUps: number;
}

const SECTION_NAMES: Record<string, string> = {
  programme: 'course choice',
  personal: 'personal details',
  nextOfKin: 'next of kin',
  education: 'education',
  funding: 'funding',
  documents: 'documents',
};

const MAX_RECIPIENTS = 300;

/** Admissions → Follow-ups: applicants who stopped part-way, and messages to bring them back. */
@Injectable()
export class FollowUpsService {
  constructor(
    @InjectRepository(Application) private readonly applications: Repository<Application>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(MessageLog) private readonly log: Repository<MessageLog>,
    @InjectRepository(ApplicationEvent) private readonly events: Repository<ApplicationEvent>,
    @InjectRepository(SiteSetting) private readonly settings: Repository<SiteSetting>,
    @InjectRepository(DocumentType) private readonly docTypes: Repository<DocumentType>,
    private readonly apps: ApplicationsService,
    private readonly messaging: MessagingService,
  ) {}

  async list(q: { stage: FollowUpStage; intakeId?: number; inactiveDays?: number; search?: string }): Promise<FollowUpPerson[]> {
    const people = q.stage === 'not_started' ? await this.notStarted() : await this.withApplication(q.stage, q.intakeId);
    const before = q.inactiveDays ? Date.now() - q.inactiveDays * 86_400_000 : null;
    const term = q.search?.trim().toLowerCase();
    const filtered = people.filter(
      (p) =>
        (!before || p.lastActivityAt.getTime() <= before) &&
        (!term || p.fullName.toLowerCase().includes(term) || p.email.toLowerCase().includes(term) || (p.phone ?? '').includes(term)),
    );
    // Follow-up history, for "last followed up".
    const ids = filtered.map((p) => p.userId);
    if (ids.length) {
      const rows = (await this.log
        .createQueryBuilder('m')
        .select('m.recipient_user_id', 'userId')
        .addSelect('MAX(m.created_at)', 'last')
        .addSelect('COUNT(DISTINCT DATE(m.created_at))', 'count')
        .where('m.recipient_user_id IN (:...ids)', { ids })
        .andWhere("m.purpose = 'follow_up' AND m.status = 'sent'")
        .groupBy('m.recipient_user_id')
        .getRawMany()) as { userId: number; last: Date; count: string }[];
      for (const r of rows) {
        const p = filtered.find((x) => x.userId === Number(r.userId));
        if (p) {
          p.lastFollowUpAt = new Date(r.last);
          p.followUps = Number(r.count);
        }
      }
    }
    return filtered.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  private async withApplication(stage: 'draft' | 'info_requested', intakeId?: number): Promise<FollowUpPerson[]> {
    const rows = await this.applications.find({
      where: {
        status: stage === 'draft' ? ApplicationStatus.Draft : ApplicationStatus.InfoRequested,
        ...(intakeId ? { intake: { id: intakeId } } : {}),
        applicant: { status: UserStatus.Active },
      },
      relations: { applicant: true, programme: true, intake: true, documents: { documentType: true } },
      order: { updatedAt: 'DESC' },
      take: 1000,
    });
    const types = await this.docTypes.find({ where: { isActive: true } });
    const out: FollowUpPerson[] = [];
    for (const a of rows) {
      const c = await this.apps.completion(a, types);
      const entries = Object.entries(c.sections);
      out.push({
        userId: a.applicant.id,
        applicationId: a.id,
        fullName: a.fullName || a.applicant.fullName,
        email: a.applicant.email,
        phone: a.phone || a.applicant.phone,
        programme: a.programme?.name ?? null,
        intake: a.intake?.name ?? null,
        intakeClosesAt: a.intake?.closesAt ?? null,
        progress: {
          done: entries.filter(([, ok]) => ok).length,
          total: entries.length,
          missing: entries.filter(([, ok]) => !ok).map(([k]) => SECTION_NAMES[k] ?? k),
        },
        lastActivityAt: a.updatedAt,
        lastFollowUpAt: null,
        followUps: 0,
      });
    }
    return out;
  }

  private async notStarted(): Promise<FollowUpPerson[]> {
    const users = await this.users
      .createQueryBuilder('u')
      .leftJoin(Application, 'a', 'a.applicant = u.id')
      .where('u.accountType = :type', { type: AccountType.Applicant })
      .andWhere('u.status = :status', { status: UserStatus.Active })
      .andWhere('a.id IS NULL')
      .orderBy('u.createdAt', 'DESC')
      .take(1000)
      .getMany();
    return users.map((u) => ({
      userId: u.id,
      applicationId: null,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      programme: null,
      intake: null,
      intakeClosesAt: null,
      progress: null,
      lastActivityAt: u.lastLoginAt ?? u.createdAt,
      lastFollowUpAt: null,
      followUps: 0,
    }));
  }

  /**
   * Sends the follow-up to each chosen person, by SMS and/or email, filling in their own details.
   * Placeholders: {first_name} {full_name} {programme} {intake} {deadline} {missing} {link} {institution}.
   */
  async send(
    input: {
      stage: FollowUpStage;
      userIds: number[];
      channels: ('sms' | 'email')[];
      smsText?: string;
      emailSubject?: string;
      emailBody?: string;
    },
    sentById: number,
  ) {
    const ids = [...new Set(input.userIds)];
    if (!ids.length) throw new BadRequestException('Choose at least one person.');
    if (ids.length > MAX_RECIPIENTS) throw new BadRequestException(`Send to at most ${MAX_RECIPIENTS} people at a time.`);
    const sms = input.channels.includes('sms');
    const email = input.channels.includes('email');
    if (!sms && !email) throw new BadRequestException('Choose SMS, email or both.');
    if (sms && !input.smsText?.trim()) throw new BadRequestException('Write the SMS.');
    if (email && (!input.emailSubject?.trim() || !input.emailBody?.trim())) throw new BadRequestException('Write the email subject and message.');

    // Only people who are still in this stage (someone may have submitted since the list was loaded).
    const people = (await this.list({ stage: input.stage })).filter((p) => ids.includes(p.userId));
    const institution = await this.institutionName();
    const link = `${(process.env.FRONTEND_ORIGIN || 'http://localhost:4300').replace(/\/$/, '')}/apply`;

    const results: {
      userId: number;
      name: string;
      sms?: { ok: boolean; recipient: string; error: string | null };
      email?: { ok: boolean; recipient: string; error: string | null };
    }[] = [];
    // A few at a time: quick, without flooding the SMS or mail provider.
    const queue = [...people];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const fill = (t: string) => personalise(t, p, institution, link);
        const meta = { purpose: 'follow_up' as const, sentById, recipientUserId: p.userId, applicationId: p.applicationId };
        const row: (typeof results)[number] = { userId: p.userId, name: p.fullName };
        if (sms) {
          if (!normalisePhone(p.phone)) row.sms = { ok: false, recipient: p.phone ?? '', error: 'No valid phone number.' };
          else {
            const r = await this.messaging.sms(p.phone!, fill(input.smsText!), meta);
            row.sms = { ok: r.ok, recipient: r.recipient, error: r.error };
          }
        }
        if (email) {
          const r = await this.messaging.email(p.email, fill(input.emailSubject!), fill(input.emailBody!), meta);
          row.email = { ok: r.ok, recipient: r.recipient, error: r.error };
        }
        const sentBy = [row.sms?.ok && 'SMS', row.email?.ok && 'email'].filter(Boolean).join(' and ');
        if (p.applicationId && sentBy)
          await this.events.insert({
            application: { id: p.applicationId },
            type: 'follow_up',
            message: `Follow-up sent by ${sentBy}.`,
            visibleToApplicant: false,
            actor: { id: sentById },
          });
        results.push(row);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const count = (k: 'sms' | 'email', ok: boolean) => results.filter((r) => r[k] && r[k]!.ok === ok).length;
    return {
      people: results.length,
      skipped: ids.length - results.length,
      sms: sms ? { sent: count('sms', true), failed: count('sms', false) } : null,
      email: email ? { sent: count('email', true), failed: count('email', false) } : null,
      results,
    };
  }

  /** The text for one person, for the preview in the admin. */
  async preview(stage: FollowUpStage, userId: number, texts: { smsText?: string; emailSubject?: string; emailBody?: string }) {
    const p = (await this.list({ stage })).find((x) => x.userId === userId);
    if (!p) throw new BadRequestException('That person is no longer in this list.');
    const institution = await this.institutionName();
    const link = `${(process.env.FRONTEND_ORIGIN || 'http://localhost:4300').replace(/\/$/, '')}/apply`;
    const fill = (t?: string) => (t ? personalise(t, p, institution, link) : '');
    return { smsText: fill(texts.smsText), emailSubject: fill(texts.emailSubject), emailBody: fill(texts.emailBody) };
  }

  private async institutionName() {
    const row = await this.settings.findOneBy({ key: 'institution.name' });
    return typeof row?.value === 'string' ? row.value : '';
  }
}

function personalise(text: string, p: FollowUpPerson, institution: string, link: string): string {
  const first = p.fullName.trim().split(/\s+/)[0] ?? '';
  const deadline = p.intakeClosesAt
    ? new Date(p.intakeClosesAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'soon';
  const values: Record<string, string> = {
    first_name: first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : 'there',
    full_name: p.fullName,
    programme: p.programme ?? 'your chosen course',
    intake: p.intake ?? 'the next intake',
    deadline,
    missing: p.progress?.missing.length ? p.progress.missing.join(', ') : 'a few details',
    link,
    institution,
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}
