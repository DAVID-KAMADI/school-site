import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Brackets, DataSource, type Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { withDeadlockRetry } from '../database/retry.js';
import { AdmissionsConfigService } from './admissions-config.service.js';
import {
  DEFAULT_MINIMUM_AGE,
  meetsGrade,
  SECTION_KEYS,
  type SectionKey,
  validateSection,
} from './application-schemas.js';
import {
  ApplicationDocument,
  DocumentReviewStatus,
} from './entities/application-document.entity.js';
import { ApplicationEvent } from './entities/application-event.entity.js';
import {
  Application,
  ApplicationStatus,
  FeeStatus,
} from './entities/application.entity.js';
import { DocumentType } from './entities/document-type.entity.js';
import { OfferLetterService, acceptBy } from './offer-letter.service.js';
import { PrivateStorage } from './private-storage.js';

/** Statuses in which the applicant may still change their answers and documents. */
const EDITABLE = new Set([
  ApplicationStatus.Draft,
  ApplicationStatus.InfoRequested,
]);
/** Statuses that end an application; the applicant may then start a new one. */
const CLOSED = new Set([
  ApplicationStatus.Rejected,
  ApplicationStatus.Withdrawn,
  ApplicationStatus.Declined,
]);

/** Status changes admissions staff may make, and whether a message to the applicant is required. */
export const TRANSITIONS: Record<string, { to: ApplicationStatus[] }> = {
  [ApplicationStatus.Submitted]: {
    to: [
      ApplicationStatus.UnderReview,
      ApplicationStatus.InfoRequested,
      ApplicationStatus.Offered,
      ApplicationStatus.Rejected,
    ],
  },
  [ApplicationStatus.UnderReview]: {
    to: [
      ApplicationStatus.InfoRequested,
      ApplicationStatus.Offered,
      ApplicationStatus.Rejected,
    ],
  },
  [ApplicationStatus.InfoRequested]: {
    to: [ApplicationStatus.UnderReview, ApplicationStatus.Rejected],
  },
  [ApplicationStatus.Offered]: { to: [ApplicationStatus.UnderReview] },
  [ApplicationStatus.Rejected]: { to: [ApplicationStatus.UnderReview] },
};
const MESSAGE_REQUIRED = new Set([
  ApplicationStatus.InfoRequested,
  ApplicationStatus.Offered,
  ApplicationStatus.Rejected,
]);
const DECISIONS = new Set([
  ApplicationStatus.Offered,
  ApplicationStatus.Rejected,
]);

const SECTION_COLUMNS: Record<
  Exclude<SectionKey, 'programme'>,
  'personal' | 'nextOfKin' | 'education' | 'funding'
> = {
  personal: 'personal',
  nextOfKin: 'nextOfKin',
  education: 'education',
  funding: 'funding',
};

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class ApplicationsService {
  private readonly storage = new PrivateStorage();

  constructor(
    @InjectRepository(Application)
    private readonly apps: Repository<Application>,
    @InjectRepository(ApplicationDocument)
    private readonly docs: Repository<ApplicationDocument>,
    @InjectRepository(ApplicationEvent)
    private readonly events: Repository<ApplicationEvent>,
    @InjectRepository(DocumentType)
    private readonly docTypes: Repository<DocumentType>,
    private readonly config: AdmissionsConfigService,
    private readonly letters: OfferLetterService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // =====================================================================
  // Applicant side
  // =====================================================================

  /** The applicant's most recent application (any status), creating a draft the first time. */
  async current(userId: number): Promise<Application> {
    const latest = await this.apps.findOne({
      where: { applicant: { id: userId } },
      order: { createdAt: 'DESC', id: 'DESC' },
      relations: { programme: true, intake: true, documents: true },
    });
    if (latest) return latest;
    const created = await this.apps.save(
      this.apps.create({
        applicant: { id: userId },
        status: ApplicationStatus.Draft,
      }),
    );
    return this.load(created.id);
  }

  /** Starts a fresh application after the previous one was withdrawn or not successful. */
  async startNew(userId: number) {
    const latest = await this.current(userId);
    if (!CLOSED.has(latest.status)) {
      throw new ConflictException(
        'You already have an application in progress.',
      );
    }
    await this.apps.save(
      this.apps.create({
        applicant: { id: userId },
        status: ApplicationStatus.Draft,
      }),
    );
    return this.applicantView(userId);
  }

  private load(id: number) {
    return this.apps.findOneOrFail({
      where: { id },
      relations: {
        programme: true,
        intake: true,
        documents: true,
        applicant: true,
      },
    });
  }

  /** What the applicant sees: answers, documents, progress, fee and visible messages. */
  async applicantView(userId: number) {
    const app = await this.current(userId);
    const [types, events, fee, days, portalUrl] = await Promise.all([
      this.docTypes.find({
        where: { isActive: true },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
      this.events.find({
        where: { application: { id: app.id }, visibleToApplicant: true },
        order: { createdAt: 'DESC' },
      }),
      this.config.setting('admissions.fee', {
        amount: 1000,
        currency: 'KSh',
        instructions: '',
      }),
      this.config.setting('admissions.offer_acceptance_days', 14),
      this.config.setting('portal.student_url', ''),
    ]);
    const hasOffer = [
      ApplicationStatus.Offered,
      ApplicationStatus.Accepted,
    ].includes(app.status);
    const deadline = app.decidedAt
      ? acceptBy(app.decidedAt, Number(days))
      : null;
    return {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      editable: EDITABLE.has(app.status),
      sections: {
        programme: app.programme
          ? {
              intakeId: app.intake?.id ?? null,
              programmeId: app.programme.id,
              studyMode: app.studyMode,
            }
          : null,
        personal: app.personal,
        nextOfKin: app.nextOfKin,
        education: app.education,
        funding: app.funding,
      },
      programme: app.programme
        ? {
            id: app.programme.id,
            name: app.programme.name,
            code: app.programme.code,
            minMeanGrade: app.programme.minMeanGrade,
          }
        : null,
      intake: app.intake
        ? {
            id: app.intake.id,
            name: app.intake.name,
            closesAt: app.intake.closesAt,
          }
        : null,
      meetsMinimumGrade: meetsGrade(app.meanGrade, app.programme?.minMeanGrade),
      completion: await this.completion(app, types),
      documents: app.documents.map((d) => this.docView(d)),
      fee: { ...fee, status: app.feeStatus, reference: app.feeReference },
      submittedAt: app.submittedAt,
      decidedAt: app.decidedAt,
      offer: hasOffer
        ? {
            acceptBy: deadline,
            canRespond:
              app.status === ApplicationStatus.Offered &&
              !!deadline &&
              deadline.getTime() >= Date.now(),
            respondedAt: app.respondedAt,
            letterAvailable: true,
          }
        : null,
      studentPortalUrl:
        app.status === ApplicationStatus.Accepted ? portalUrl || null : null,
      messages: events.map((e) => ({
        id: e.id,
        type: e.type,
        toStatus: e.toStatus,
        message: e.message,
        createdAt: e.createdAt,
      })),
    };
  }

  /** Site settings → Admissions → Minimum age. */
  private async minimumAge(): Promise<number> {
    const value = Number(
      await this.config.setting('admissions.minimum_age', DEFAULT_MINIMUM_AGE),
    );
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MINIMUM_AGE;
  }

  /** Which sections are complete, and which required documents are missing. */
  private async completion(app: Application, types?: DocumentType[]) {
    const docTypes =
      types ?? (await this.docTypes.find({ where: { isActive: true } }));
    const minimumAge = await this.minimumAge();
    const sections: Record<string, boolean> = {
      programme: !!(app.programme && app.intake && app.studyMode),
    };
    for (const key of Object.keys(
      SECTION_COLUMNS,
    ) as (keyof typeof SECTION_COLUMNS)[]) {
      sections[key] = validateSection(
        key,
        app[SECTION_COLUMNS[key]],
        'complete',
        { minimumAge },
      ).ok;
    }
    const uploaded = new Set(
      app.documents
        .filter((d) => d.status !== DocumentReviewStatus.Rejected)
        .map((d) => d.documentType.id),
    );
    const missingDocuments = docTypes
      .filter((t) => t.isRequired && !uploaded.has(t.id))
      .map((t) => ({ id: t.id, name: t.name }));
    sections['documents'] = missingDocuments.length === 0;
    return {
      sections,
      missingDocuments,
      ready: Object.values(sections).every(Boolean),
    };
  }

  private assertEditable(app: Application) {
    if (!EDITABLE.has(app.status)) {
      throw new ForbiddenException({
        message:
          'This application has been submitted and can no longer be changed.',
        code: 'NOT_EDITABLE',
      });
    }
  }

  /** Saves one section of the form. Drafts may be incomplete; invalid values are rejected. */
  async saveSection(userId: number, key: string, data: unknown) {
    if (!(SECTION_KEYS as string[]).includes(key))
      throw new NotFoundException('Unknown section.');
    const app = await this.current(userId);
    this.assertEditable(app);
    const result = validateSection(key as SectionKey, data, 'draft', {
      minimumAge: await this.minimumAge(),
    });
    if (!result.ok)
      throw new UnprocessableEntityException({
        message: 'Please check the highlighted answers.',
        code: 'INVALID_SECTION',
        issues: result.issues,
      });

    if (key === 'programme') {
      const { intakeId, programmeId, studyMode } = result.data as {
        intakeId?: number;
        programmeId?: number;
        studyMode?: string;
      };
      const changes: Partial<Application> = {};
      if (intakeId !== undefined) {
        if (
          !(await this.config.isIntakeOpen(intakeId)) &&
          app.intake?.id !== intakeId
        )
          throw new BadRequestException(
            'That intake is not open for applications.',
          );
        changes.intake = { id: intakeId } as Application['intake'];
      }
      if (programmeId !== undefined) {
        const options = await this.config.options();
        const programme = options.programmes.find((p) => p.id === programmeId);
        if (!programme)
          throw new BadRequestException('That programme is not available.');
        if (studyMode && !programme.studyModes.includes(studyMode))
          throw new BadRequestException(
            'That study mode is not offered for this programme.',
          );
        changes.programme = { id: programmeId } as Application['programme'];
      }
      if (studyMode !== undefined) changes.studyMode = studyMode;
      await this.apps.update(app.id, changes as never);
    } else {
      const column = SECTION_COLUMNS[key as keyof typeof SECTION_COLUMNS];
      const data = result.data;
      const changes: Partial<Application> = { [column]: data };
      if (key === 'personal') {
        changes.fullName =
          [data['firstName'], data['middleName'], data['lastName']]
            .filter(Boolean)
            .join(' ')
            .slice(0, 200) || null;
        changes.phone = (data['phone'] as string) ?? null;
      }
      if (key === 'education') {
        changes.kcseIndexNumber = (data['kcseIndexNumber'] as string) ?? null;
        changes.meanGrade = (data['meanGrade'] as string) ?? null;
      }
      await this.apps.update(app.id, changes as never);
    }
    return this.applicantView(userId);
  }

  async uploadDocument(
    userId: number,
    documentTypeId: number,
    file: UploadedFile,
  ) {
    const app = await this.current(userId);
    this.assertEditable(app);
    const type = await this.docTypes.findOneBy({
      id: documentTypeId,
      isActive: true,
    });
    if (!type) throw new BadRequestException('Unknown document type.');
    if (!file?.buffer?.length)
      throw new BadRequestException('No file received.');
    if (file.size > type.maxSizeMb * 1024 * 1024)
      throw new PayloadTooLargeException(
        `${type.name} must be ${type.maxSizeMb} MB or smaller.`,
      );

    // Check the real file content, not the name or browser-supplied type.
    const head = file.buffer.subarray(0, 8);
    let kind: 'pdf' | 'jpeg' | 'png' | null = null;
    if (head.subarray(0, 4).toString('latin1') === '%PDF') kind = 'pdf';
    else if (head[0] === 0xff && head[1] === 0xd8) kind = 'jpeg';
    else if (
      head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      kind = 'png';
    if (!kind) throw new BadRequestException('Upload a PDF, JPG or PNG file.');
    if (type.accepts === 'pdf' && kind !== 'pdf')
      throw new BadRequestException(`${type.name} must be a PDF.`);
    if (type.accepts === 'image' && kind === 'pdf')
      throw new BadRequestException(
        `${type.name} must be a photo (JPG or PNG).`,
      );

    let data = file.buffer;
    if (kind !== 'pdf') {
      // Re-encode photos: strips location data and other metadata, and rejects malformed images.
      try {
        data = await sharp(file.buffer, { limitInputPixels: 50_000_000 })
          .rotate()
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new BadRequestException(
          'This image could not be read. Try taking the photo again.',
        );
      }
    }
    const storageKey = `applications/${app.id}/${randomUUID()}.${kind === 'pdf' ? 'pdf' : 'jpg'}`;
    await this.storage.put(storageKey, data);

    // One current file per document type: replacing removes the previous upload.
    const previous = app.documents.filter((d) => d.documentType.id === type.id);
    await this.docs.save(
      this.docs.create({
        application: { id: app.id },
        documentType: type,
        originalName: file.originalname.slice(0, 255),
        storageKey,
        mimeType: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
        sizeBytes: data.length,
      }),
    );
    for (const p of previous) {
      await this.docs.delete(p.id);
      await this.storage.remove(p.storageKey);
    }
    return this.applicantView(userId);
  }

  async deleteDocument(userId: number, documentId: number) {
    const app = await this.current(userId);
    this.assertEditable(app);
    const doc = app.documents.find((d) => d.id === documentId);
    if (!doc) throw new NotFoundException('Document not found.');
    await this.docs.delete(doc.id);
    await this.storage.remove(doc.storageKey);
    return this.applicantView(userId);
  }

  /** Opens a document file, checking the requester may see it. */
  async openDocument(
    documentId: number,
    viewer: { userId: number; isStaff: boolean },
  ) {
    const doc = await this.docs.findOne({
      where: { id: documentId },
      relations: { application: { applicant: true } },
    });
    if (
      !doc ||
      (!viewer.isStaff && doc.application.applicant.id !== viewer.userId)
    )
      throw new NotFoundException('Document not found.');
    return {
      stream: this.storage.read(doc.storageKey),
      mimeType: doc.mimeType,
      name: doc.originalName,
    };
  }

  /** Submits (or re-submits after a request for information). Everything must be complete. */
  async submit(userId: number, declarationAccepted: boolean) {
    const app = await this.current(userId);
    this.assertEditable(app);
    if (!declarationAccepted)
      throw new BadRequestException(
        'Please confirm the declaration before submitting.',
      );

    const issues: string[] = [];
    const { sections, missingDocuments } = await this.completion(app);
    const names: Record<string, string> = {
      programme: 'Programme choice',
      personal: 'Personal details',
      nextOfKin: 'Next of kin',
      education: 'Education',
      funding: 'Funding',
    };
    for (const [key, ok] of Object.entries(sections))
      if (!ok && key !== 'documents')
        issues.push(`${names[key]} is incomplete.`);
    for (const d of missingDocuments) issues.push(`Upload your ${d.name}.`);
    if (
      app.status === ApplicationStatus.Draft &&
      app.intake &&
      !(await this.config.isIntakeOpen(app.intake.id))
    ) {
      issues.push(
        'Applications for this intake have closed. Choose another intake.',
      );
    }
    if (issues.length)
      throw new UnprocessableEntityException({
        message: 'Your application is not complete yet.',
        code: 'INCOMPLETE',
        issues,
      });

    const resubmission = app.status === ApplicationStatus.InfoRequested;
    const to = resubmission
      ? ApplicationStatus.UnderReview
      : ApplicationStatus.Submitted;
    const prefix = await this.config.setting('admissions.number_prefix', 'APP');
    await withDeadlockRetry(() =>
      this.dataSource.transaction(async (em) => {
        await em.update(Application, app.id, {
          status: to,
          declarationAcceptedAt: new Date(),
          submittedAt: app.submittedAt ?? new Date(),
          applicationNumber:
            app.applicationNumber ??
            `${prefix}-${new Date().getFullYear()}-${String(app.id).padStart(6, '0')}`,
        });
        await em.save(
          em.create(ApplicationEvent, {
            application: { id: app.id },
            type: 'status',
            fromStatus: app.status,
            toStatus: to,
            message: resubmission
              ? 'You sent the information we asked for. We are reviewing your application again.'
              : 'Application received. We will review it and get back to you.',
            visibleToApplicant: true,
            actor: { id: userId },
          }),
        );
      }),
    );
    await this.audit.record({
      action: resubmission ? 'application.resubmit' : 'application.submit',
      userId,
      entityType: 'application',
      entityId: app.id,
    });
    return this.applicantView(userId);
  }

  /** The applicant tells us their M-Pesa confirmation code; staff confirm it later. */
  async reportFee(userId: number, reference: string) {
    const app = await this.current(userId);
    if (app.status === ApplicationStatus.Draft)
      throw new BadRequestException('Submit your application first.');
    if (app.feeStatus === FeeStatus.Verified)
      throw new ConflictException('Your fee has already been confirmed.');
    const code = reference.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(code))
      throw new BadRequestException(
        'M-Pesa confirmation codes have 10 letters and numbers, e.g. SGH7K2L9QX.',
      );
    await this.apps.update(app.id, {
      feeStatus: FeeStatus.Claimed,
      feeReference: code,
    });
    await this.addEvent(
      app.id,
      userId,
      'fee',
      `Applicant reported payment with M-Pesa code ${code}.`,
      true,
    );
    return this.applicantView(userId);
  }

  /** The applicant accepts or declines an offer, before the deadline. */
  async respondToOffer(userId: number, accept: boolean) {
    const app = await this.current(userId);
    if (app.status !== ApplicationStatus.Offered)
      throw new BadRequestException('There is no open offer to respond to.');
    const days = await this.config.setting(
      'admissions.offer_acceptance_days',
      14,
    );
    if (
      app.decidedAt &&
      acceptBy(app.decidedAt, Number(days)).getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'The deadline to respond to this offer has passed. Please contact the admissions office.',
      );
    }
    const to = accept ? ApplicationStatus.Accepted : ApplicationStatus.Declined;
    await this.apps.update(app.id, { status: to, respondedAt: new Date() });
    await this.addEvent(
      app.id,
      userId,
      'status',
      accept
        ? 'You accepted your offer of admission. Welcome!'
        : 'You declined the offer of admission.',
      true,
      app.status,
      to,
    );
    await this.audit.record({
      action: accept
        ? 'application.offer_accepted'
        : 'application.offer_declined',
      userId,
      entityType: 'application',
      entityId: app.id,
    });
    return this.applicantView(userId);
  }

  /** The offer letter PDF for the applicant's own application. */
  async applicantOfferLetter(userId: number) {
    const app = await this.current(userId);
    return this.offerLetterFor(app.id);
  }

  /** The offer letter PDF for any offered or accepted application (staff). */
  async offerLetterFor(id: number) {
    const app = await this.apps.findOne({
      where: { id },
      relations: { programme: true, intake: true },
    });
    if (
      !app ||
      ![ApplicationStatus.Offered, ApplicationStatus.Accepted].includes(
        app.status,
      )
    ) {
      throw new NotFoundException(
        'There is no offer letter for this application.',
      );
    }
    return {
      pdf: await this.letters.render(app),
      name: `offer-of-admission-${app.applicationNumber}.pdf`,
    };
  }

  async withdraw(userId: number) {
    const app = await this.current(userId);
    if (app.status === ApplicationStatus.Offered)
      throw new BadRequestException(
        'Use “Decline offer” to turn down your place.',
      );
    if (
      [
        ApplicationStatus.Accepted,
        ApplicationStatus.Declined,
        ApplicationStatus.Withdrawn,
        ApplicationStatus.Rejected,
      ].includes(app.status)
    )
      throw new BadRequestException(
        'This application can no longer be withdrawn. Contact the admissions office.',
      );
    await this.apps.update(app.id, { status: ApplicationStatus.Withdrawn });
    await this.addEvent(
      app.id,
      userId,
      'status',
      'You withdrew this application.',
      true,
      app.status,
      ApplicationStatus.Withdrawn,
    );
    await this.audit.record({
      action: 'application.withdraw',
      userId,
      entityType: 'application',
      entityId: app.id,
    });
    return { ok: true };
  }

  /** Message from the applicant to admissions (e.g. answering a request for information). */
  async applicantMessage(userId: number, message: string) {
    const app = await this.current(userId);
    if (app.status === ApplicationStatus.Draft)
      throw new BadRequestException('Submit your application first.');
    await this.addEvent(
      app.id,
      userId,
      'applicant_reply',
      message.trim().slice(0, 2000),
      true,
    );
    return this.applicantView(userId);
  }

  // =====================================================================
  // Staff side
  // =====================================================================

  async counts() {
    const rows: { status: string; n: string }[] = await this.dataSource.query(
      "SELECT status, COUNT(*) n FROM applications WHERE status <> 'draft' GROUP BY status",
    );
    const drafts: { n: string }[] = await this.dataSource.query(
      "SELECT COUNT(*) n FROM applications WHERE status = 'draft'",
    );
    return {
      ...Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])),
      draft: Number(drafts[0].n),
    };
  }

  async list(q: {
    status?: string;
    programmeId?: number;
    intakeId?: number;
    search?: string;
    fee?: string;
    page?: number;
    pageSize?: number;
  }) {
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const page = Math.max(q.page ?? 1, 1);
    const qb = this.filtered(q)
      .orderBy('a.submittedAt', 'DESC')
      .addOrderBy('a.id', 'DESC');
    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: rows.map((a) => ({
        id: a.id,
        applicationNumber: a.applicationNumber,
        fullName: a.fullName,
        email: a.applicant.email,
        phone: a.phone,
        programme: a.programme?.name ?? null,
        intake: a.intake?.name ?? null,
        status: a.status,
        feeStatus: a.feeStatus,
        meanGrade: a.meanGrade,
        meetsMinimumGrade: meetsGrade(a.meanGrade, a.programme?.minMeanGrade),
        submittedAt: a.submittedAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private filtered(q: {
    status?: string;
    programmeId?: number;
    intakeId?: number;
    search?: string;
    fee?: string;
  }) {
    const qb = this.apps
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.applicant', 'u')
      .leftJoinAndSelect('a.programme', 'p')
      .leftJoinAndSelect('a.intake', 'i');
    if (q.status) qb.andWhere('a.status = :status', { status: q.status });
    else qb.andWhere("a.status <> 'draft'");
    if (q.programmeId) qb.andWhere('p.id = :pid', { pid: q.programmeId });
    if (q.intakeId) qb.andWhere('i.id = :iid', { iid: q.intakeId });
    if (q.fee) qb.andWhere('a.feeStatus = :fee', { fee: q.fee });
    if (q.search) {
      const s = `%${q.search.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('a.fullName LIKE :s', { s })
            .orWhere('a.applicationNumber LIKE :s', { s })
            .orWhere('a.kcseIndexNumber LIKE :s', { s })
            .orWhere('a.phone LIKE :s', { s })
            .orWhere('u.email LIKE :s', { s }),
        ),
      );
    }
    return qb;
  }

  /** Every application matching the list filters, oldest first (for the CSV and PDF exports). */
  exportRows(q: Parameters<ApplicationsService['list']>[0]) {
    return this.filtered(q)
      .orderBy('a.submittedAt', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getMany();
  }

  async exportCsv(q: Parameters<ApplicationsService['list']>[0]) {
    const rows = await this.exportRows(q);
    const header = [
      'Application number',
      'Full name',
      'Email',
      'Phone',
      'Programme',
      'Intake',
      'Study mode',
      'KCSE index',
      'Mean grade',
      'Status',
      'Fee',
      'Submitted',
    ];
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Stop spreadsheet formula injection.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((a) =>
      [
        a.applicationNumber,
        a.fullName,
        a.applicant.email,
        a.phone,
        a.programme?.name,
        a.intake?.name,
        a.studyMode,
        a.kcseIndexNumber,
        a.meanGrade,
        a.status,
        a.feeStatus,
        a.submittedAt?.toISOString(),
      ]
        .map(esc)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n');
  }

  async staffView(id: number) {
    const app = await this.apps.findOne({
      where: { id },
      relations: {
        programme: true,
        intake: true,
        documents: { reviewedBy: true },
        applicant: true,
        feeVerifiedBy: true,
      },
    });
    if (!app || app.status === ApplicationStatus.Draft)
      throw new NotFoundException('Application not found.');
    const events = await this.events.find({
      where: { application: { id } },
      relations: { actor: true },
      order: { createdAt: 'DESC' },
    });
    return {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      allowedTransitions: TRANSITIONS[app.status]?.to ?? [],
      applicant: {
        id: app.applicant.id,
        email: app.applicant.email,
        fullName: app.fullName ?? app.applicant.fullName,
      },
      programme: app.programme,
      intake: app.intake,
      studyMode: app.studyMode,
      personal: app.personal,
      nextOfKin: app.nextOfKin,
      education: app.education,
      funding: app.funding,
      meetsMinimumGrade: meetsGrade(app.meanGrade, app.programme?.minMeanGrade),
      fee: {
        status: app.feeStatus,
        reference: app.feeReference,
        verifiedBy: app.feeVerifiedBy?.fullName ?? null,
        verifiedAt: app.feeVerifiedAt,
      },
      documents: app.documents.map((d) => ({
        ...this.docView(d),
        reviewedBy: d.reviewedBy?.fullName ?? null,
      })),
      submittedAt: app.submittedAt,
      decidedAt: app.decidedAt,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        message: e.message,
        visibleToApplicant: e.visibleToApplicant,
        actor: e.actor?.fullName ?? null,
        createdAt: e.createdAt,
      })),
    };
  }

  async changeStatus(
    id: number,
    to: ApplicationStatus,
    message: string | undefined,
    actorId: number,
    canDecide: boolean,
  ) {
    const app = await this.apps.findOneBy({ id });
    if (!app || app.status === ApplicationStatus.Draft)
      throw new NotFoundException('Application not found.');
    if (!TRANSITIONS[app.status]?.to.includes(to))
      throw new BadRequestException(
        `An application that is "${app.status}" cannot be moved to "${to}".`,
      );
    if (DECISIONS.has(to) && !canDecide)
      throw new ForbiddenException(
        'Only staff who can make admission decisions may offer or reject.',
      );
    if (MESSAGE_REQUIRED.has(to) && !message?.trim())
      throw new BadRequestException(
        'Write a message to the applicant explaining this.',
      );
    await this.apps.update(id, {
      status: to,
      decidedAt: DECISIONS.has(to) ? new Date() : app.decidedAt,
    });
    await this.addEvent(
      id,
      actorId,
      'status',
      message?.trim() || null,
      true,
      app.status,
      to,
    );
    await this.audit.record({
      action: 'application.status',
      userId: actorId,
      entityType: 'application',
      entityId: id,
      details: { from: app.status, to },
    });
    return this.staffView(id);
  }

  async addNote(
    id: number,
    message: string,
    visibleToApplicant: boolean,
    actorId: number,
  ) {
    if (!(await this.apps.exists({ where: { id } })))
      throw new NotFoundException('Application not found.');
    await this.addEvent(
      id,
      actorId,
      visibleToApplicant ? 'message' : 'note',
      message.trim(),
      visibleToApplicant,
    );
    return this.staffView(id);
  }

  async reviewDocument(
    id: number,
    documentId: number,
    status: DocumentReviewStatus,
    note: string | undefined,
    actorId: number,
  ) {
    const doc = await this.docs.findOne({
      where: { id: documentId, application: { id } },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    if (status === DocumentReviewStatus.Rejected && !note?.trim())
      throw new BadRequestException(
        'Tell the applicant why the document was not accepted.',
      );
    await this.docs.update(documentId, {
      status,
      reviewNote: note?.trim() || null,
      reviewedBy: { id: actorId },
      reviewedAt: new Date(),
    });
    const label = `${doc.documentType.name}: ${status === DocumentReviewStatus.Accepted ? 'accepted' : status === DocumentReviewStatus.Rejected ? `not accepted. ${note?.trim()}` : 'marked as pending'}`;
    await this.addEvent(
      id,
      actorId,
      'document',
      label,
      status === DocumentReviewStatus.Rejected,
    );
    return this.staffView(id);
  }

  async setFee(
    id: number,
    status: FeeStatus.Verified | FeeStatus.Unpaid,
    actorId: number,
  ) {
    if (!(await this.apps.exists({ where: { id } })))
      throw new NotFoundException('Application not found.');
    await this.apps.update(id, {
      feeStatus: status,
      feeVerifiedBy: status === FeeStatus.Verified ? { id: actorId } : null,
      feeVerifiedAt: status === FeeStatus.Verified ? new Date() : null,
    });
    await this.addEvent(
      id,
      actorId,
      'fee',
      status === FeeStatus.Verified
        ? 'Application fee received. Thank you.'
        : 'Application fee marked as not received.',
      true,
    );
    await this.audit.record({
      action: 'application.fee',
      userId: actorId,
      entityType: 'application',
      entityId: id,
      details: { status },
    });
    return this.staffView(id);
  }

  // ---------------------------------------------------------------------

  private docView(d: ApplicationDocument) {
    return {
      id: d.id,
      documentTypeId: d.documentType.id,
      documentType: d.documentType.name,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      reviewNote: d.reviewNote,
      uploadedAt: d.uploadedAt,
    };
  }

  private async addEvent(
    applicationId: number,
    actorId: number | null,
    type: string,
    message: string | null,
    visible: boolean,
    from?: string,
    to?: string,
  ) {
    await this.events.save(
      this.events.create({
        application: { id: applicationId },
        type,
        message,
        visibleToApplicant: visible,
        fromStatus: from ?? null,
        toStatus: to ?? null,
        actor: actorId ? { id: actorId } : null,
      }),
    );
  }
}
