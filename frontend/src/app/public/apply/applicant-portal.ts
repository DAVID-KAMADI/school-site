import { DatePipe, KeyValuePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import {
  ApplicantApi, COUNTIES, FEE_LABELS, FUNDING_LABELS, GENDER_LABELS, ID_TYPE_LABELS, KCSE_GRADES, KCSE_SUBJECTS, LEVEL_LABELS,
  OTHER_COUNTRIES, RCMRD_MEMBER_STATES, STATUS_LABELS, STUDY_MODE_LABELS, formatMoney, type AdmissionsOptions, type ApplicantApplication, type ProgrammeOption,
} from '../../core/admissions';
import { AuthStore } from '../../core/auth';
import { SiteStore } from '../../core/site';

type Obj = Record<string, unknown>;

interface Step {
  key: 'programme' | 'personal' | 'nextOfKin' | 'education' | 'funding' | 'documents' | 'review';
  textKey: string;
  fallback: string;
}

const STEPS: Step[] = [
  { key: 'programme', textKey: 'programme', fallback: 'Programme' },
  { key: 'personal', textKey: 'personal', fallback: 'Personal details' },
  { key: 'nextOfKin', textKey: 'next_of_kin', fallback: 'Next of kin' },
  { key: 'education', textKey: 'education', fallback: 'Education' },
  { key: 'funding', textKey: 'funding', fallback: 'Funding' },
  { key: 'documents', textKey: 'documents', fallback: 'Documents' },
  { key: 'review', textKey: 'review', fallback: 'Review & submit' },
];

/** /apply/application: the multi-step form while editable, and the status page after submitting. */
@Component({
  selector: 'app-applicant-portal',
  imports: [FormsModule, DatePipe, KeyValuePipe],
  templateUrl: './applicant-portal.html',
  styleUrls: ['./apply.scss', './applicant-portal.scss'],
})
export class ApplicantPortal {
  protected readonly site = inject(SiteStore);
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(ApplicantApi);
  private readonly router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly labels = { STATUS_LABELS, STUDY_MODE_LABELS, LEVEL_LABELS, FUNDING_LABELS, GENDER_LABELS, ID_TYPE_LABELS, FEE_LABELS };
  protected readonly grades = KCSE_GRADES;
  protected readonly subjects = KCSE_SUBJECTS;
  protected readonly counties = COUNTIES.filter((c) => c !== 'Outside Kenya');
  protected readonly rcmrdStates = RCMRD_MEMBER_STATES;
  protected readonly otherCountries = OTHER_COUNTRIES;

  protected readonly app = signal<ApplicantApplication | null>(null);
  protected readonly options = signal<AdmissionsOptions | null>(null);
  protected readonly step = signal(0);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly issues = signal<string[]>([]);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly uploading = signal<number | null>(null);
  protected readonly editingSubmitted = signal(false);
  protected readonly notice = signal('');

  /** Local copies of each section that the inputs edit. */
  protected forms: Record<string, Obj> = {};
  protected declaration = false;
  protected feeReference = '';
  protected reply = '';

  protected readonly showForm = computed(() => {
    const a = this.app();
    return !!a && a.editable && (a.status === 'draft' || this.editingSubmitted());
  });
  protected readonly currentStep = computed(() => this.steps[this.step()]);
  protected readonly fee = computed(() => this.app()?.fee ?? null);
  protected readonly feeText = computed(() => formatMoney(this.fee()));
  protected readonly paybill = computed(() => this.site.setting<string>('payments.mpesa_paybill') || '');
  protected readonly declarationText = computed(() => (this.options()?.settings['admissions.declaration'] as string) ?? '');
  protected readonly selectedProgramme = computed<ProgrammeOption | undefined>(() => {
    this.version();
    return this.options()?.programmes.find((p) => p.id === this.forms['programme']?.['programmeId']);
  });
  /** Programmes grouped by school for the select list. */
  protected readonly programmeGroups = computed(() => {
    const groups = new Map<string, ProgrammeOption[]>();
    for (const p of this.options()?.programmes ?? []) groups.set(p.school, [...(groups.get(p.school) ?? []), p]);
    return [...groups.entries()].map(([school, items]) => ({ school, items }));
  });
  protected readonly version = signal(0);

  /** Site settings → Admissions → Minimum age (16 unless changed). */
  protected readonly minimumAge = computed(() => {
    const value = Number(this.options()?.settings['admissions.minimum_age'] ?? 16);
    return Number.isFinite(value) && value > 0 ? value : 16;
  });

  /** The most recent birth date that is old enough today, for the date picker. */
  protected readonly latestBirthDate = computed(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - this.minimumAge());
    return isoDate(d);
  });

  /** The server's message, or the age requirement as soon as a too-recent date is chosen. */
  protected dobError(): string {
    const fromServer = this.err('dateOfBirth');
    if (fromServer) return fromServer;
    const dob = String(this.forms['personal']?.['dateOfBirth'] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return '';
    const age = ageToday(dob);
    if (age < 0) return 'Check the date of birth';
    return age < this.minimumAge()
      ? `You must be at least ${this.minimumAge()} years old to be admitted. With this date of birth you are ${age}, so you do not meet the age requirement.`
      : '';
  }

  constructor() {
    inject(Title).setTitle(`My application | ${this.site.institutionName()}`);
    void this.load();
  }

  private async load() {
    const me = this.auth.me() ?? (await this.auth.refresh());
    if (!me || !this.auth.can('applications.apply')) {
      await this.router.navigateByUrl('/apply');
      return;
    }
    try {
      const [options, app] = await Promise.all([this.api.options(), this.api.application()]);
      this.options.set(options);
      this.apply(app, true);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private apply(app: ApplicantApplication, resetForms = false) {
    this.app.set(app);
    if (resetForms) {
      const s = app.sections;
      this.forms = {
        programme: { intakeId: null, programmeId: null, studyMode: null, ...(s['programme'] ?? {}) },
        personal: { firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: '', nationality: 'Kenyan', idType: 'national_id', idNumber: '', phone: '', country: '', county: '', region: '', address: '', disability: '', ...(s['personal'] ?? {}) },
        nextOfKin: { name: '', relationship: '', phone: '', email: '', ...(s['nextOfKin'] ?? {}) },
        education: { kcseIndexNumber: '', kcseYear: null, meanGrade: '', secondarySchool: '', subjects: [], otherQualifications: [], ...(s['education'] ?? {}) },
        funding: { method: '', sponsorName: '', ...(s['funding'] ?? {}) },
      };
      // Applications started before the country question: a Kenyan county means they live in Kenya.
      const personal = this.forms['personal'];
      if (!personal['country'] && personal['county'] && personal['county'] !== 'Outside Kenya') personal['country'] = 'Kenya';
      if (!this.forms['programme']['intakeId'] &&this.options()?.intakes.length === 1) this.forms['programme']['intakeId'] = this.options()!.intakes[0].id;
      // Resume at the first incomplete step.
      const first = STEPS.findIndex((st) => st.key !== 'review' && !app.completion.sections[st.key]);
      this.step.set(first === -1 ? STEPS.length - 1 : first);
    }
    this.version.update((v) => v + 1);
  }

  // ---------- Navigation and saving ----------

  protected stepDone(key: string) {
    return !!this.app()?.completion.sections[key];
  }

  async goTo(index: number) {
    if (index === this.step()) return;
    if (await this.saveCurrent(false)) {
      this.step.set(index);
      this.scrollTop();
    }
  }

  async next() {
    if (await this.saveCurrent(true)) {
      this.step.update((i) => Math.min(i + 1, STEPS.length - 1));
      this.scrollTop();
    }
  }

  back() {
    void this.goTo(Math.max(this.step() - 1, 0));
  }

  /** Saves the current step. `strict` blocks moving on when the server reports problems. */
  private async saveCurrent(strict: boolean): Promise<boolean> {
    const key = this.currentStep().key;
    if (key === 'documents' || key === 'review') return true;
    this.busy.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    try {
      this.apply(await this.api.saveSection(key, this.clean(key)));
      this.flashSaved();
      return true;
    } catch (err) {
      const body = (err as HttpErrorResponse).error as { issues?: { path: string; message: string }[] } | undefined;
      if (body?.issues) this.fieldErrors.set(Object.fromEntries(body.issues.map((i) => [i.path, i.message])));
      this.error.set(errorMessage(err));
      return !strict && !body?.issues;
    } finally {
      this.busy.set(false);
    }
  }

  /** Converts form values to what the API expects (numbers, empty rows removed). */
  private clean(key: string): Obj {
    const f = { ...this.forms[key] };
    if (key === 'programme') {
      for (const k of ['intakeId', 'programmeId']) f[k] = f[k] ? Number(f[k]) : undefined;
      if (!f['studyMode']) delete f['studyMode'];
    }
    // Counties are only for Kenya; a region or city only for other countries.
    if (key === 'personal') {
      if (f['country'] === 'Kenya') f['region'] = '';
      else f['county'] = '';
    }
    if (key === 'education') {
      f['kcseYear'] = f['kcseYear'] ? Number(f['kcseYear']) : undefined;
      f['subjects'] = (f['subjects'] as Obj[]).filter((s) => s['subject'] && s['grade']);
      f['otherQualifications'] = (f['otherQualifications'] as Obj[])
        .filter((q) => q['institution'] || q['qualification'])
        .map((q) => ({ ...q, year: Number(q['year']) || undefined }));
    }
    return f;
  }

  private flashSaved() {
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }

  private scrollTop() {
    document.querySelector('.portal')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected err(path: string) {
    return this.fieldErrors()[path];
  }

  protected chooseProgramme(id: unknown) {
    this.forms['programme']['programmeId'] = Number(id) || null;
    const modes = this.options()?.programmes.find((p) => p.id === Number(id))?.studyModes ?? [];
    if (!modes.includes(String(this.forms['programme']['studyMode']))) this.forms['programme']['studyMode'] = modes[0] ?? null;
    this.version.update((v) => v + 1);
  }

  protected list(section: string, key: string): Obj[] {
    return this.forms[section][key] as Obj[];
  }

  protected addRow(section: string, key: string, row: Obj) {
    this.list(section, key).push(row);
  }

  protected removeRow(section: string, key: string, i: number) {
    this.list(section, key).splice(i, 1);
  }

  // ---------- Documents ----------

  protected docFor(typeId: number) {
    return this.app()?.documents.find((d) => d.documentTypeId === typeId) ?? null;
  }

  protected accept(type: string) {
    return type === 'pdf' ? 'application/pdf' : type === 'image' ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png';
  }

  async upload(typeId: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading.set(typeId);
    this.error.set('');
    try {
      this.apply(await this.api.upload(typeId, file));
      this.flashSaved();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.uploading.set(null);
    }
  }

  async removeDoc(id: number) {
    try {
      this.apply(await this.api.deleteDocument(id));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected fileUrl(id: number) {
    return this.api.documentUrl(id);
  }

  protected size(bytes: number) {
    return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  // ---------- Review and submit ----------

  protected programmeName(id: unknown) {
    return this.options()?.programmes.find((p) => p.id === id)?.name ?? '';
  }

  protected intakeName(id: unknown) {
    return this.options()?.intakes.find((i) => i.id === id)?.name ?? this.app()?.intake?.name ?? '';
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    this.issues.set([]);
    try {
      const app = await this.api.submit();
      this.editingSubmitted.set(false);
      this.apply(app);
      this.notice.set(this.site.t('apply.submitted_title', 'Application received'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const body = (err as HttpErrorResponse).error as { issues?: string[] } | undefined;
      if (Array.isArray(body?.issues)) this.issues.set(body.issues as string[]);
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Status page actions ----------

  async sendFee() {
    try {
      this.apply(await this.api.reportFee(this.feeReference));
      this.feeReference = '';
      this.error.set('');
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async sendReply() {
    if (!this.reply.trim()) return;
    try {
      this.apply(await this.api.message(this.reply));
      this.reply = '';
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  editAgain() {
    this.editingSubmitted.set(true);
    const app = this.app();
    if (app) this.apply(app, true);
  }

  async withdraw() {
    if (!confirm('Withdraw your application? You can start a new one afterwards.')) return;
    await this.api.withdraw();
    this.apply(await this.api.application(), true);
  }

  async respondToOffer(accept: boolean) {
    const question = accept
      ? 'Accept this offer of admission?'
      : 'Decline this offer? You will lose your place, and this cannot be undone.';
    if (!confirm(question)) return;
    try {
      this.apply(await (accept ? this.api.acceptOffer() : this.api.declineOffer()));
      this.error.set('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected letterUrl() {
    return this.api.offerLetterUrl();
  }

  async startNew() {
    try {
      this.notice.set('');
      this.apply(await this.api.startNew(), true);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async signOut() {
    await this.auth.logout();
    await this.router.navigateByUrl('/apply');
  }

  protected statusExplanation(status: string): string {
    const defaults: Record<string, string> = {
      submitted: 'We have received your application. Our admissions team will review it and contact you.',
      under_review: 'Our admissions team is reviewing your application.',
      info_requested: 'We need a little more information. Read the message below, update your application and submit it again.',
      offered: 'Congratulations! You have been offered a place. Read the message below for next steps.',
      rejected: 'Unfortunately your application was not successful this time. Read the message below for details.',
      withdrawn: 'You withdrew this application.',
      accepted: 'You have accepted your place. Welcome! Follow the joining instructions in your offer letter.',
      declined: 'You declined this offer. You can start a new application at any time.',
    };
    return this.site.t(`apply.status.${status}`, defaults[status] ?? '');
  }
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole years from a YYYY-MM-DD birth date to today, counting birthdays. Mirrors ageOn in the API. */
function ageToday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years--;
  return years;
}
