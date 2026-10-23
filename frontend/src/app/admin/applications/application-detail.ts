import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { FEE_LABELS, FUNDING_LABELS, GENDER_LABELS, ID_TYPE_LABELS, STATUS_LABELS, STUDY_MODE_LABELS } from '../../core/admissions';
import { AuthStore } from '../../core/auth';
import { AdminApi } from '../api';
import { AdmissionsAdminApi, type StaffApplication, type StaffDocument } from './admissions-api';

const ACTION_LABELS: Record<string, string> = {
  under_review: 'Start review',
  info_requested: 'Request more information',
  offered: 'Offer a place',
  rejected: 'Not successful',
};

const MESSAGE_HINTS: Record<string, string> = {
  info_requested: 'Tell the applicant exactly what to send or correct.',
  offered: 'Congratulate the applicant and explain the next steps (acceptance, fees, reporting date).',
  rejected: 'Explain the decision kindly and, if possible, suggest an alternative programme.',
};

/** One application: details, documents, fee, decision actions and full history. */
@Component({
  selector: 'app-application-detail',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './application-detail.html',
  styleUrl: './applications.scss',
})
export class ApplicationDetail implements OnInit {
  private readonly api = inject(AdmissionsAdminApi);
  protected readonly auth = inject(AuthStore);
  private readonly title = inject(Title);
  private readonly adminApi = inject(AdminApi);
  /** Site settings: decision message templates, institution name, days to accept an offer. */
  private settings: Record<string, unknown> = {};

  readonly id = input.required<string>();

  protected readonly app = signal<StaffApplication | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly action = signal<string | null>(null);
  protected readonly rejecting = signal<StaffDocument | null>(null);
  protected readonly labels = { STATUS_LABELS, STUDY_MODE_LABELS, FUNDING_LABELS, GENDER_LABELS, ID_TYPE_LABELS, FEE_LABELS, ACTION_LABELS, MESSAGE_HINTS };
  protected readonly canReview = computed(() => this.auth.can('applications.review'));
  protected readonly canDecide = computed(() => this.auth.can('applications.decide'));

  protected actionMessage = '';
  protected rejectNote = '';
  protected note = '';
  protected noteVisible = false;

  ngOnInit(): void {
    void this.load();
    void this.adminApi
      .settings()
      .then((rows) => (this.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))))
      .catch(() => undefined);
  }

  private async load() {
    try {
      this.set(await this.api.detail(Number(this.id())));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private set(app: StaffApplication) {
    this.app.set(app);
    this.title.setTitle(`${app.applicationNumber} | Applications`);
  }

  private async run(work: () => Promise<StaffApplication>, done: string) {
    this.error.set('');
    try {
      this.set(await work());
      this.notice.set(done);
      return true;
    } catch (err) {
      this.error.set(errorMessage(err));
      return false;
    }
  }

  protected allowed(to: string) {
    return to === 'offered' || to === 'rejected' ? this.canDecide() : this.canReview();
  }

  openAction(to: string) {
    this.actionMessage = this.template(to);
    if (to === 'under_review') void this.confirmAction(to);
    else this.action.set(to);
  }

  /** Whether a ready-made message exists for this action (Site settings → Admissions). */
  protected hasTemplate(to: string) {
    return typeof this.settings[`admissions.message_${to}`] === 'string';
  }

  protected useTemplate(to: string) {
    this.actionMessage = this.template(to);
  }

  /** The ready-made message for an action, filled in with this applicant's details. */
  private template(to: string): string {
    const raw = this.settings[`admissions.message_${to}`];
    const a = this.app();
    if (typeof raw !== 'string' || !a) return '';
    const personal = a.personal ?? {};
    const days = Number(this.settings['admissions.offer_acceptance_days'] ?? 14);
    const acceptBy = new Date();
    acceptBy.setDate(acceptBy.getDate() + (Number.isFinite(days) ? days : 14));
    const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const startsOn = a.intake?.startsOn ? longDate(new Date(`${a.intake.startsOn}T00:00:00`)) : 'the reporting date in your offer letter';
    const values: Record<string, string> = {
      first_name: String(personal['firstName'] ?? '').trim() || a.applicant.fullName.split(' ')[0] || 'Applicant',
      full_name: a.applicant.fullName,
      application_number: a.applicationNumber,
      programme: a.programme?.name ?? 'the programme you applied for',
      study_mode: a.studyMode ? (STUDY_MODE_LABELS[a.studyMode] ?? a.studyMode).toLowerCase() : 'full time',
      intake: a.intake?.name ?? 'next',
      starts_on: startsOn,
      accept_by: longDate(acceptBy),
      institution_name: String(this.settings['institution.name'] ?? 'our institution'),
    };
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => values[name] ?? m);
  }

  async confirmAction(to = this.action()!) {
    const ok = await this.run(() => this.api.setStatus(Number(this.id()), to, this.actionMessage.trim() || undefined), `Status changed to “${STATUS_LABELS[to]}”.`);
    if (ok) this.action.set(null);
  }

  async acceptDoc(d: StaffDocument) {
    await this.run(() => this.api.reviewDocument(Number(this.id()), d.id, 'accepted'), `${d.documentType} accepted.`);
  }

  openReject(d: StaffDocument) {
    this.rejectNote = '';
    this.rejecting.set(d);
  }

  async confirmReject() {
    const d = this.rejecting()!;
    const ok = await this.run(() => this.api.reviewDocument(Number(this.id()), d.id, 'rejected', this.rejectNote), `${d.documentType} marked as not accepted.`);
    if (ok) this.rejecting.set(null);
  }

  async fee(status: 'verified' | 'unpaid') {
    await this.run(() => this.api.setFee(Number(this.id()), status), status === 'verified' ? 'Fee confirmed as received.' : 'Fee marked as not received.');
  }

  async addNote() {
    if (!this.note.trim()) return;
    const ok = await this.run(() => this.api.addNote(Number(this.id()), this.note, this.noteVisible), this.noteVisible ? 'Message sent to the applicant.' : 'Internal note added.');
    if (ok) this.note = '';
  }

  protected letterUrl() {
    return `/api/v1/admin/applications/${this.id()}/offer-letter.pdf`;
  }

  protected fileUrl(docId: number) {
    return this.api.fileUrl(Number(this.id()), docId);
  }

  protected size(bytes: number) {
    return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected val(obj: Record<string, unknown> | null, key: string): string {
    const v = obj?.[key];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }

  protected rows(obj: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
    const v = obj?.[key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  }
}
