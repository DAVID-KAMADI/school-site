import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { buildGrid, DAY_NAMES, DAY_SHORT, ROOM_TYPE_LABELS, type GridItem, type GridPeriod } from '../../core/timetable';
import { TimetableApi, type Board, type Lesson, type Session, type SlotOption, type Unplaced } from './timetable-api';

type Tab = 'timetable' | 'lessons' | 'periods' | 'details';
type ViewKind = 'class' | 'lecturer' | 'room';
type Message = { kind: 'success' | 'error' | 'warning' | 'info'; text: string; list?: string[] };
interface LessonForm {
  id: number | null;
  unitId: number | null;
  lecturerId: number | null;
  classIds: number[];
  sessionsPerWeek: number;
  length: number;
  roomType: string | null;
  notes: string;
}
interface PeriodForm {
  id?: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  label: string;
}

/**
 * One term's timetable: the weekly grid (view by class, lecturer or room), the lessons to schedule,
 * and the term's days and periods. Every placement is checked by the server; a selected session shows
 * which slots are free and why the others are not.
 */
@Component({
  selector: 'app-term-workspace',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './term-workspace.html',
  styleUrl: './term-workspace.scss',
})
export class TermWorkspace implements OnInit {
  private readonly api = inject(TimetableApi);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);

  /** Route parameter. */
  readonly id = input.required<string>();
  protected readonly termId = computed(() => Number(this.id()));

  protected readonly dayNames = DAY_NAMES;
  protected readonly dayShort = DAY_SHORT;
  protected readonly allDays = [1, 2, 3, 4, 5, 6, 7];
  protected readonly roomTypes = ROOM_TYPE_LABELS;
  protected readonly roomTypeKeys = Object.keys(ROOM_TYPE_LABELS);

  protected readonly board = signal<Board | null>(null);
  protected readonly tab = signal<Tab>('timetable');
  protected readonly message = signal<Message | null>(null);
  protected readonly busy = signal(false);

  // ---------- Grid state
  protected readonly viewKind = signal<ViewKind>('class');
  protected readonly viewId = signal<number | null>(null);
  protected readonly selected = signal<number | null>(null);
  protected readonly options = signal<Map<string, SlotOption>>(new Map());
  protected readonly pending = signal<{ day: number; periodId: number; roomIds: number[]; roomId: number; warnings: string[] } | null>(null);

  // ---------- Forms
  protected readonly lessonForm = signal<LessonForm | null>(null);
  protected readonly formError = signal('');
  protected periodRows: PeriodForm[] = [];
  protected details = { name: '', startsOn: '', endsOn: '', days: [] as number[] };

  // ---------- Lookups
  protected readonly lessons = computed(() => new Map((this.board()?.lessons ?? []).map((l) => [l.id, l])));
  private readonly unitById = computed(() => new Map((this.board()?.units ?? []).map((u) => [u.id, u])));
  private readonly lecturerById = computed(() => new Map((this.board()?.lecturers ?? []).map((l) => [l.id, l])));
  private readonly classById = computed(() => new Map((this.board()?.classes ?? []).map((c) => [c.id, c])));
  private readonly roomById = computed(() => new Map((this.board()?.rooms ?? []).map((r) => [r.id, r])));
  protected readonly teachingPeriods = computed(() => (this.board()?.periods ?? []).filter((p) => !p.isBreak).length);
  protected readonly placedCount = computed(() => (this.board()?.sessions ?? []).filter((s) => s.day !== null).length);

  /** Choices for the "show" list, by view kind; only things that appear in this term's lessons. */
  protected readonly viewChoices = computed(() => {
    const b = this.board();
    if (!b) return [];
    const lessons = b.lessons;
    switch (this.viewKind()) {
      case 'class': {
        const ids = new Set(lessons.flatMap((l) => l.classIds));
        return b.classes.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
      }
      case 'lecturer': {
        const ids = new Set(lessons.map((l) => l.lecturerId));
        return b.lecturers.filter((l) => ids.has(l.id)).map((l) => ({ id: l.id, name: l.name }));
      }
      default:
        return b.rooms.filter((r) => r.isActive).map((r) => ({ id: r.id, name: `${r.name} (${r.capacity})` }));
    }
  });

  /** Does a session belong to what the grid is showing? */
  private readonly inView = computed(() => {
    const kind = this.viewKind();
    const id = this.viewId();
    const lessons = this.lessons();
    return (s: Session) => {
      if (id === null) return true;
      const l = lessons.get(s.lessonId)!;
      if (kind === 'class') return l.classIds.includes(id);
      if (kind === 'lecturer') return l.lecturerId === id;
      return s.roomId === id;
    };
  });

  protected readonly grid = computed(() => {
    const b = this.board();
    if (!b || this.viewId() === null) return [];
    const lessons = this.lessons();
    const items: GridItem<Session>[] = b.sessions
      .filter((s) => s.day !== null && this.inView()(s))
      .map((s) => ({ day: s.day!, startPeriodId: s.startPeriodId!, length: lessons.get(s.lessonId)!.length, data: s }));
    return buildGrid(b.periods, b.term.days, items);
  });

  /** Unplaced sessions for the current view (all of them when nothing is chosen). */
  protected readonly unplaced = computed(() => {
    const b = this.board();
    if (!b) return [];
    const kind = this.viewKind();
    return b.sessions.filter((s) => s.day === null && (kind === 'room' || this.inView()(s)));
  });

  protected readonly issues = computed(() => this.board()?.issues ?? []);

  /** Weekly load per class and lecturer, to spot impossible loads before generating. */
  protected readonly loads = computed(() => {
    const b = this.board();
    if (!b) return [];
    const capacity = this.teachingPeriods() * b.term.days.length;
    const out: { name: string; needed: number; capacity: number; limit: number | null }[] = [];
    for (const c of b.classes) {
      const needed = b.lessons.filter((l) => l.classIds.includes(c.id)).reduce((n, l) => n + l.sessionsPerWeek * l.length, 0);
      if (needed) out.push({ name: c.name, needed, capacity, limit: null });
    }
    for (const l of b.lecturers) {
      const needed = b.lessons.filter((x) => x.lecturerId === l.id).reduce((n, x) => n + x.sessionsPerWeek * x.length, 0);
      if (needed) out.push({ name: l.name, needed, capacity, limit: l.maxPeriodsPerDay ? l.maxPeriodsPerDay * b.term.days.length : null });
    }
    return out.filter((x) => x.needed > Math.min(x.capacity, x.limit ?? Infinity));
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    try {
      const b = await this.api.board(this.termId());
      this.board.set(b);
      this.titleService.setTitle(`${b.term.name} | Timetable`);
      this.periodRows = b.periods.map((p) => ({ id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak, label: p.label ?? '' }));
      this.details = { name: b.term.name, startsOn: b.term.startsOn, endsOn: b.term.endsOn, days: [...b.term.days] };
      if (this.viewId() === null || !this.viewChoices().some((c) => c.id === this.viewId())) this.viewId.set(this.viewChoices()[0]?.id ?? null);
      if (this.selected() !== null && !b.sessions.some((s) => s.id === this.selected())) this.clearSelection();
      else if (this.selected() !== null) await this.loadOptions(this.selected()!);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  // ================================================================ labels

  protected lessonOf(s: Session): Lesson {
    return this.lessons().get(s.lessonId)!;
  }

  protected unitLabel(l: Lesson) {
    const u = this.unitById().get(l.unitId);
    return u ? `${u.code} ${u.name}` : '';
  }

  protected unitCode(l: Lesson) {
    return this.unitById().get(l.unitId)?.code ?? '';
  }

  protected classNames(l: Lesson) {
    return l.classIds.map((id) => this.classById().get(id)?.name ?? '').join(' + ');
  }

  protected lecturerName(id: number) {
    return this.lecturerById().get(id)?.name ?? '';
  }

  protected roomName(id: number | null) {
    return id === null ? '' : (this.roomById().get(id)?.name ?? '');
  }

  protected periodTime(p: GridPeriod) {
    return `${p.startsAt}–${p.endsAt}`;
  }

  protected readonly selectedSession = computed(() => this.board()?.sessions.find((s) => s.id === this.selected()) ?? null);

  protected issueTitle(sessionId: number) {
    const s = this.board()?.sessions.find((x) => x.id === sessionId);
    return s ? this.sessionTitle(s) : '';
  }

  protected periodTimeById(id: number) {
    const p = this.board()?.periods.find((x) => x.id === id);
    return p ? this.periodTime(p) : '';
  }

  protected sessionTitle(s: Session) {
    const l = this.lessonOf(s);
    return `${this.unitLabel(l)} · ${this.classNames(l)} · ${this.lecturerName(l.lecturerId)}`;
  }

  /** The second line of a grid card: what the current view does not already say. */
  protected cardDetail(s: Session) {
    const l = this.lessonOf(s);
    switch (this.viewKind()) {
      case 'class':
        return [this.lecturerName(l.lecturerId), this.roomName(s.roomId)];
      case 'lecturer':
        return [this.classNames(l), this.roomName(s.roomId)];
      default:
        return [this.classNames(l), this.lecturerName(l.lecturerId)];
    }
  }

  protected placedOf(l: Lesson) {
    return (this.board()?.sessions ?? []).filter((s) => s.lessonId === l.id && s.day !== null).length;
  }

  // ================================================================ selecting and placing

  protected setView(kind: ViewKind) {
    this.viewKind.set(kind);
    this.viewId.set(this.viewChoices()[0]?.id ?? null);
    this.pending.set(null);
  }

  async select(s: Session) {
    if (this.selected() === s.id) {
      this.clearSelection();
      return;
    }
    this.selected.set(s.id);
    this.pending.set(null);
    await this.loadOptions(s.id);
  }

  protected clearSelection() {
    this.selected.set(null);
    this.options.set(new Map());
    this.pending.set(null);
  }

  private async loadOptions(sessionId: number) {
    try {
      const list = await this.api.options(this.termId(), sessionId);
      this.options.set(new Map(list.map((o) => [`${o.day}:${o.periodId}`, o])));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected option(day: number, periodId: number) {
    return this.options().get(`${day}:${periodId}`);
  }

  /** Status of an empty cell while a session is selected. */
  protected cellState(day: number, periodId: number): 'ok' | 'warn' | 'blocked' | null {
    if (this.selected() === null) return null;
    const o = this.option(day, periodId);
    if (!o) return 'blocked';
    if (!o.roomIds.length) return 'blocked';
    return o.warnings.length ? 'warn' : 'ok';
  }

  protected cellHint(day: number, periodId: number) {
    const o = this.option(day, periodId);
    if (!o) return '';
    if (!o.roomIds.length) return o.reasons.join(' ');
    return [`${o.roomIds.length} room(s) free`, ...o.warnings].join('. ');
  }

  protected chooseCell(day: number, periodId: number) {
    const o = this.option(day, periodId);
    if (!o || !o.roomIds.length) {
      if (o) this.message.set({ kind: 'warning', text: `${DAY_NAMES[day]}: not possible.`, list: o.reasons });
      return;
    }
    // In the room view, use the room being viewed when it is one of the free ones.
    const preferred = this.viewKind() === 'room' && o.roomIds.includes(this.viewId()!) ? this.viewId()! : o.roomIds[0];
    this.pending.set({ day, periodId, roomIds: o.roomIds, roomId: preferred, warnings: o.warnings });
  }

  async confirmPlace() {
    const p = this.pending();
    const id = this.selected();
    if (!p || id === null) return;
    this.busy.set(true);
    try {
      const res = await this.api.place(this.termId(), id, { day: p.day, periodId: p.periodId, roomId: p.roomId });
      this.message.set(res.warnings.length ? { kind: 'warning', text: 'Placed.', list: res.warnings } : { kind: 'success', text: 'Placed.' });
      this.clearSelection();
      await this.load();
    } catch (err) {
      this.showError(err);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  async unplace(s: Session) {
    try {
      await this.api.unplace(this.termId(), s.id);
      this.clearSelection();
      await this.load();
    } catch (err) {
      this.showError(err);
    }
  }

  async toggleLock(s: Session) {
    try {
      await this.api.lock(this.termId(), s.id, !s.locked);
      await this.load();
    } catch (err) {
      this.showError(err);
    }
  }

  async generate(rebuild: boolean) {
    if (rebuild && !confirm('Rebuild the whole timetable? Every session except locked ones will be placed again.')) return;
    this.busy.set(true);
    this.message.set({ kind: 'info', text: rebuild ? 'Rebuilding the timetable…' : 'Filling empty slots…' });
    this.clearSelection();
    try {
      const res = await this.api.generate(this.termId(), rebuild);
      await this.load();
      this.message.set(
        res.unplaced.length
          ? {
              kind: 'warning',
              text: `Placed ${res.placed} session(s) in ${res.seconds}s. ${res.unplaced.length} could not be placed without a clash:`,
              list: this.describeUnplaced(res.unplaced),
            }
          : { kind: 'success', text: `Done: ${res.placed} session(s) placed in ${res.seconds}s with no clashes.` },
      );
    } catch (err) {
      this.showError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private describeUnplaced(list: Unplaced[]) {
    const sessions = this.board()?.sessions ?? [];
    return list.map((u) => {
      const s = sessions.find((x) => x.id === u.sessionId);
      return s ? `${this.sessionTitle(s)}: ${u.reason}` : u.reason;
    });
  }

  // ================================================================ lessons

  newLesson() {
    this.formError.set('');
    this.lessonForm.set({ id: null, unitId: null, lecturerId: null, classIds: [], sessionsPerWeek: 2, length: 1, roomType: null, notes: '' });
  }

  editLesson(l: Lesson) {
    this.formError.set('');
    this.lessonForm.set({ id: l.id, unitId: l.unitId, lecturerId: l.lecturerId, classIds: [...l.classIds], sessionsPerWeek: l.sessionsPerWeek, length: l.length, roomType: l.roomType, notes: l.notes ?? '' });
  }

  protected toggleClass(f: LessonForm, id: number, on: boolean) {
    f.classIds = on ? [...f.classIds, id] : f.classIds.filter((c) => c !== id);
  }

  async saveLesson() {
    const f = this.lessonForm()!;
    try {
      const res = await this.api.saveLesson(this.termId(), f.id, {
        unitId: f.unitId,
        lecturerId: f.lecturerId,
        classIds: f.classIds,
        sessionsPerWeek: Number(f.sessionsPerWeek),
        length: Number(f.length),
        roomType: f.roomType,
        notes: f.notes.trim() || null,
      });
      this.lessonForm.set(null);
      await this.load();
      this.message.set(
        res.unplaced.length
          ? { kind: 'warning', text: 'Lesson saved. These sessions no longer fit where they were and were taken off the timetable:', list: this.describeUnplaced(res.unplaced) }
          : { kind: 'success', text: 'Lesson saved.' },
      );
    } catch (err) {
      this.formError.set(errorMessage(err));
    }
  }

  async deleteLesson(l: Lesson) {
    if (!confirm(`Delete ${this.unitLabel(l)} for ${this.classNames(l)}? Its sessions are removed from the timetable.`)) return;
    try {
      await this.api.deleteLesson(this.termId(), l.id);
      await this.load();
    } catch (err) {
      this.showError(err);
    }
  }

  // ================================================================ periods and details

  protected addPeriod() {
    const last = this.periodRows.at(-1);
    const start = last?.endsAt ?? '08:00';
    this.periodRows.push({ startsAt: start, endsAt: addMinutes(start, 60), isBreak: false, label: '' });
  }

  protected movePeriod(i: number, step: number) {
    const j = i + step;
    if (j < 0 || j >= this.periodRows.length) return;
    [this.periodRows[i], this.periodRows[j]] = [this.periodRows[j], this.periodRows[i]];
  }

  async savePeriods() {
    this.busy.set(true);
    try {
      const res = await this.api.savePeriods(
        this.termId(),
        this.periodRows.map((p) => ({ ...(p.id ? { id: p.id } : {}), startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak, label: p.label.trim() || null })),
      );
      await this.load();
      this.message.set(
        res.unplaced.length
          ? { kind: 'warning', text: 'Periods saved. These sessions no longer fit and were taken off the timetable:', list: this.describeUnplaced(res.unplaced) }
          : { kind: 'success', text: 'Periods saved.' },
      );
    } catch (err) {
      this.showError(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleDay(d: number, on: boolean) {
    const days = new Set(this.details.days);
    if (on) days.add(d);
    else days.delete(d);
    this.details.days = [...days].sort();
  }

  async saveDetails() {
    try {
      const res = await this.api.updateTerm(this.termId(), this.details);
      await this.load();
      this.message.set(
        res.unplaced.length
          ? { kind: 'warning', text: 'Saved. Sessions on days that were removed were taken off the timetable:', list: this.describeUnplaced(res.unplaced) }
          : { kind: 'success', text: 'Saved.' },
      );
    } catch (err) {
      this.showError(err);
    }
  }

  async publish(on: boolean) {
    const b = this.board();
    if (!b) return;
    if (on) {
      const missing = b.sessions.length - this.placedCount();
      const warn = [missing ? `${missing} session(s) are not placed yet.` : '', this.issues().length ? `${this.issues().length} session(s) have problems.` : '']
        .filter(Boolean)
        .join(' ');
      if (!confirm(`${warn ? warn + ' ' : ''}Publish this timetable on the website?`)) return;
    } else if (!confirm('Take this timetable off the website?')) return;
    try {
      if (on) await this.api.publish(this.termId());
      else await this.api.unpublish(this.termId());
      await this.load();
      this.message.set({ kind: 'success', text: on ? 'Published. Visitors can see it at /timetable.' : 'The timetable is no longer on the website.' });
    } catch (err) {
      this.showError(err);
    }
  }

  async deleteTerm() {
    const b = this.board();
    if (!b || !confirm(`Delete ${b.term.name} with all its lessons and its timetable? This cannot be undone.`)) return;
    try {
      await this.api.deleteTerm(this.termId());
      await this.router.navigateByUrl('/admin/timetable');
    } catch (err) {
      this.showError(err);
    }
  }

  private showError(err: unknown) {
    const body = (err as { error?: { conflicts?: string[] } }).error;
    this.message.set({ kind: 'error', text: errorMessage(err), list: body?.conflicts && body.conflicts.length > 1 ? body.conflicts : undefined });
  }
}

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
