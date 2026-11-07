import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import { DELIVERY_LABELS, KCSE_GRADES, LEVEL_LABELS, STUDY_MODE_LABELS } from '../../core/admissions';
import { MediaField } from '../fields/media-field';
import { MediaCache } from '../media/media-cache';
import { AdmissionsAdminApi, type DocumentTypeRow, type IntakeRow, type ProgrammeRow, type ShortCourseRow } from './admissions-api';

type Tab = 'programmes' | 'shortCourses' | 'intakes' | 'documents';
type Editable = Record<string, unknown> & { id?: number };
type Action = 'create' | 'edit' | 'delete';

/** The permission for each action in each tab, as set per role in Access control. */
const PERMISSION_PREFIX: Record<Tab, string> = {
  programmes: 'programmes',
  shortCourses: 'short_courses',
  intakes: 'intakes',
  documents: 'document_types',
};
const TAB_ORDER: Tab[] = ['programmes', 'shortCourses', 'intakes', 'documents'];
const NOUN: Record<Tab, string> = { programmes: 'programme', shortCourses: 'short course', intakes: 'intake', documents: 'required document' };

/** Programmes, short courses, intakes and required documents. Each tab and action follows the person's permissions. */
@Component({
  selector: 'app-admissions-setup',
  imports: [FormsModule, DatePipe, RouterLink, MediaField],
  templateUrl: './admissions-setup.html',
  styleUrl: './applications.scss',
})
export class AdmissionsSetup {
  private readonly api = inject(AdmissionsAdminApi);
  private readonly mediaCache = inject(MediaCache);
  private readonly auth = inject(AuthStore);
  protected readonly delivery = DELIVERY_LABELS;
  protected readonly deliveryKeys = Object.keys(DELIVERY_LABELS);
  protected readonly levels = LEVEL_LABELS;
  protected readonly levelKeys = Object.keys(LEVEL_LABELS);
  protected readonly modes = STUDY_MODE_LABELS;
  protected readonly modeKeys = Object.keys(STUDY_MODE_LABELS);
  protected readonly grades = KCSE_GRADES;

  /** Tabs this person may see: any permission in that area. */
  protected readonly tabs = TAB_ORDER.filter((t) => (['create', 'edit', 'delete'] as Action[]).some((a) => this.can(t, a)));
  protected readonly tab = signal<Tab>(this.tabs[0] ?? 'programmes');
  protected readonly noun = NOUN;
  protected readonly programmes = signal<ProgrammeRow[]>([]);
  protected readonly shortCourses = signal<ShortCourseRow[]>([]);
  /** Categories already in use, suggested when typing a new one. */
  protected readonly categories = computed(() => [...new Set(this.shortCourses().map((c) => c.category).filter(Boolean))].sort());
  protected readonly intakes = signal<IntakeRow[]>([]);
  protected readonly docTypes = signal<DocumentTypeRow[]>([]);
  protected readonly editing = signal<{ kind: Tab; row: Editable } | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  constructor() {
    inject(Title).setTitle('Admissions setup | Admin');
    void this.load();
  }

  /** Loads only the lists this person may see. */
  private async load() {
    const shown = new Set(this.tabs);
    try {
      await Promise.all([
        shown.has('programmes') && this.api.programmes().then((p) => this.programmes.set(p)),
        shown.has('shortCourses') &&
          this.api.shortCourses().then((s) => {
            this.mediaCache.add(...s.map((c) => c.image));
            this.shortCourses.set(s);
          }),
        shown.has('intakes') &&
          this.api.intakes().then((i) => {
            this.mediaCache.add(...i.map((intake) => intake.popupImage));
            this.intakes.set(i);
          }),
        shown.has('documents') && this.api.documentTypes().then((d) => this.docTypes.set(d)),
      ]);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected can(kind: Tab, action: Action): boolean {
    return this.auth.can(`${PERMISSION_PREFIX[kind]}.${action}`);
  }

  /** Whether the open form can be saved: creating needs create, changing needs edit. */
  protected canWrite(e: { kind: Tab; row: Editable }): boolean {
    return this.can(e.kind, e.row.id ? 'edit' : 'create');
  }

  protected popupEnabled(row: Editable): boolean {
    return row['popupEnabled'] === true;
  }

  protected isOpen(i: IntakeRow) {
    const now = Date.now();
    return i.isActive && new Date(i.opensAt).getTime() <= now && new Date(i.closesAt).getTime() >= now;
  }

  newRow(kind: Tab) {
    const rows: Record<Tab, Editable> = {
      programmes: { code: '', name: '', level: 'diploma', school: '', duration: '', studyModes: ['full_time'], minMeanGrade: null, description: '', isActive: true, sortOrder: 0 },
      shortCourses: { title: '', category: '', summary: '', duration: '', fee: '', delivery: 'in_person', schedule: '', nextStartOn: '', imageId: null, isActive: true, sortOrder: 0 },
      intakes: {
        name: '',
        opensAt: localInput(new Date()),
        closesAt: localInput(new Date(Date.now() + 60 * 86_400_000)),
        startsOn: '',
        isActive: true,
        popupEnabled: false,
        popupTitle: '',
        popupDetails: '',
        popupImageId: null,
      },
      documents: { name: '', description: '', isRequired: true, accepts: 'any', maxSizeMb: 5, isActive: true, sortOrder: this.docTypes().length },
    };
    this.error.set('');
    this.editing.set({ kind, row: rows[kind] });
  }

  edit(kind: Tab, row: ProgrammeRow | ShortCourseRow | IntakeRow | DocumentTypeRow) {
    const copy: Editable = { ...row };
    delete copy['image'];
    if (kind === 'intakes') {
      copy['opensAt'] = localInput(new Date(String(copy['opensAt'])));
      copy['closesAt'] = localInput(new Date(String(copy['closesAt'])));
      copy['popupTitle'] ??= '';
      copy['popupDetails'] ??= '';
    }
    if (kind === 'programmes') copy['studyModes'] = [...(copy['studyModes'] as string[])];
    this.error.set('');
    this.editing.set({ kind, row: copy });
  }

  protected hasMode(row: Editable, mode: string) {
    return (row['studyModes'] as string[]).includes(mode);
  }

  protected toggleMode(row: Editable, mode: string, on: boolean) {
    const modes = new Set(row['studyModes'] as string[]);
    if (on) modes.add(mode);
    else modes.delete(mode);
    row['studyModes'] = this.modeKeys.filter((m) => modes.has(m));
  }

  async save() {
    const { kind, row } = this.editing()!;
    const id = row.id ?? null;
    const body: Editable = { ...row };
    delete body.id;
    for (const k of ['createdAt', 'updatedAt']) delete body[k];
    for (const k of ['duration', 'description', 'startsOn', 'fee', 'schedule', 'nextStartOn', 'popupTitle', 'popupDetails']) if (body[k] === '') body[k] = null;
    if (kind === 'intakes') {
      body['opensAt'] = new Date(String(body['opensAt'])).toISOString();
      body['closesAt'] = new Date(String(body['closesAt'])).toISOString();
    }
    for (const k of ['sortOrder', 'maxSizeMb']) if (k in body) body[k] = Number(body[k]);
    try {
      if (kind === 'programmes') await this.api.saveProgramme(id, body);
      if (kind === 'shortCourses') await this.api.saveShortCourse(id, body);
      if (kind === 'intakes') await this.api.saveIntake(id, body);
      if (kind === 'documents') await this.api.saveDocumentType(id, body);
      this.editing.set(null);
      this.notice.set(kind === 'shortCourses' ? 'Saved. The website shows the change straight away.' : 'Saved. Applicants see the change straight away.');
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async remove(kind: Tab, row: Editable) {
    const id = row.id!;
    const name = String(row['name'] ?? row['title'] ?? '');
    const hide: Record<Tab, string> = {
      programmes: 'untick "Applicants can choose this programme"',
      shortCourses: 'untick "Show on the website"',
      intakes: 'untick "Show this intake"',
      documents: 'untick "Ask applicants for this document"',
    };
    if (!confirm(`Delete the ${NOUN[kind]} "${name}"? This cannot be undone. To hide it for now, ${hide[kind]} instead.`)) return;
    try {
      if (kind === 'programmes') await this.api.deleteProgramme(id);
      if (kind === 'shortCourses') await this.api.deleteShortCourse(id);
      if (kind === 'intakes') await this.api.deleteIntake(id);
      if (kind === 'documents') await this.api.deleteDocumentType(id);
      this.editing.set(null);
      this.notice.set(`${NOUN[kind].charAt(0).toUpperCase() + NOUN[kind].slice(1)} "${name}" deleted.`);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async removeIntakePopup(row: Editable) {
    const id = row.id!;
    const name = String(row['name']);
    if (!confirm(`Delete the pop-up for "${name}"? The intake itself will remain.`)) return;
    const body: Editable = { ...row, popupEnabled: false, popupTitle: null, popupDetails: null, popupImageId: null };
    delete body.id;
    delete body['popupImage'];
    for (const k of ['createdAt', 'updatedAt']) delete body[k];
    body['opensAt'] = new Date(String(body['opensAt'])).toISOString();
    body['closesAt'] = new Date(String(body['closesAt'])).toISOString();
    try {
      await this.api.saveIntake(id, body);
      this.editing.set(null);
      this.notice.set(`Pop-up for "${name}" deleted. The intake is unchanged.`);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
