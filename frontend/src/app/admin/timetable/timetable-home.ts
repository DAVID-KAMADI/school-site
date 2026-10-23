import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { DAY_NAMES, DAY_SHORT, ROOM_TYPE_LABELS } from '../../core/timetable';
import { TimetableApi, type Lecturer, type ResourceKind, type Resources, type Term } from './timetable-api';

type Tab = 'terms' | ResourceKind;
type Row = Record<string, unknown> & { id?: number };

const TAB_LABELS: Record<Tab, string> = {
  terms: 'Terms',
  rooms: 'Rooms',
  lecturers: 'Lecturers',
  classes: 'Classes',
  units: 'Units',
};

/** Timetable home: terms, and the rooms, lecturers, classes and units every term uses. */
@Component({
  selector: 'app-timetable-home',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <h1>Timetable</h1>
    <p class="a-muted intro">
      Set up rooms, lecturers, classes and units once. Then, for each term, list what each class is taught (lessons) and let the system
      build a timetable with no clashes: no room, lecturer or class is ever booked twice at the same time.
    </p>
    @if (notice(); as n) {
      <div class="a-alert a-alert--success" role="status">{{ n }}</div>
    }
    @if (error() && !editing()) {
      <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
    }

    <div class="tabs" role="tablist">
      @for (t of tabs; track t) {
        <button role="tab" type="button" [attr.aria-selected]="tab() === t" (click)="tab.set(t)">
          {{ tabLabels[t] }} <span class="a-muted">{{ count(t) }}</span>
        </button>
      }
    </div>

    <section class="a-panel">
      <div class="a-toolbar a-toolbar--spread">
        <h2>{{ tabLabels[tab()] }}</h2>
        <button class="a-btn a-btn--primary" type="button" (click)="newRow(tab())">+ New {{ singular(tab()) }}</button>
      </div>
      <div class="a-table-wrap">
        @switch (tab()) {
          @case ('terms') {
            <table class="a-table">
              <thead><tr><th>Term</th><th>Dates</th><th>Teaching days</th><th>Placed</th><th>Status</th><th></th></tr></thead>
              <tbody>
                @for (t of terms(); track t.id) {
                  <tr>
                    <td><a [routerLink]="['/admin/timetable', t.id]"><strong>{{ t.name }}</strong></a></td>
                    <td>{{ t.startsOn | date: 'd MMM y' }} – {{ t.endsOn | date: 'd MMM y' }}</td>
                    <td>{{ dayList(t.days) }}</td>
                    <td>{{ t.placed }} / {{ t.sessions }} sessions</td>
                    <td>
                      @if (t.status === 'published') {
                        <span class="a-badge a-badge--live">Published</span>
                      } @else {
                        <span class="a-badge">Draft</span>
                      }
                    </td>
                    <td><a class="a-btn a-btn--sm" [routerLink]="['/admin/timetable', t.id]">Open</a></td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="a-empty">No terms yet. Add rooms, lecturers, classes and units first, then create a term.</td></tr>
                }
              </tbody>
            </table>
          }
          @case ('rooms') {
            <table class="a-table">
              <thead><tr><th>Room</th><th>Type</th><th>Seats</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                @for (r of res()?.rooms ?? []; track r.id) {
                  <tr [class.inactive]="!r.isActive">
                    <td><strong>{{ r.name }}</strong>@if (!r.isActive) { <span class="a-badge">Not in use</span> }</td>
                    <td>{{ roomTypes[r.type] }}</td>
                    <td>{{ r.capacity }}</td>
                    <td class="a-small">{{ r.notes }}</td>
                    <td><button class="a-btn a-btn--sm" type="button" (click)="edit('rooms', r)">Edit</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="a-empty">No rooms yet.</td></tr>
                }
              </tbody>
            </table>
          }
          @case ('lecturers') {
            <table class="a-table">
              <thead><tr><th>Lecturer</th><th>Department</th><th>Most periods a day</th><th>Not available</th><th></th></tr></thead>
              <tbody>
                @for (l of res()?.lecturers ?? []; track l.id) {
                  <tr [class.inactive]="!l.isActive">
                    <td><strong>{{ l.name }}</strong>@if (!l.isActive) { <span class="a-badge">Not teaching</span> }<div class="a-small a-muted">{{ l.email }}</div></td>
                    <td>{{ l.department }}</td>
                    <td>{{ l.maxPeriodsPerDay ?? 'No limit' }}</td>
                    <td class="a-small">{{ unavailableText(l) }}</td>
                    <td><button class="a-btn a-btn--sm" type="button" (click)="edit('lecturers', l)">Edit</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="a-empty">No lecturers yet.</td></tr>
                }
              </tbody>
            </table>
          }
          @case ('classes') {
            <table class="a-table">
              <thead><tr><th>Class</th><th>Programme</th><th>Students</th><th></th></tr></thead>
              <tbody>
                @for (c of res()?.classes ?? []; track c.id) {
                  <tr [class.inactive]="!c.isActive">
                    <td><strong>{{ c.name }}</strong>@if (!c.isActive) { <span class="a-badge">Not active</span> }</td>
                    <td>{{ programmeName(c.programmeId) }}</td>
                    <td>{{ c.size }}</td>
                    <td><button class="a-btn a-btn--sm" type="button" (click)="edit('classes', c)">Edit</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="a-empty">No classes yet.</td></tr>
                }
              </tbody>
            </table>
          }
          @case ('units') {
            <table class="a-table">
              <thead><tr><th>Code</th><th>Unit</th><th>Needs</th><th></th></tr></thead>
              <tbody>
                @for (u of res()?.units ?? []; track u.id) {
                  <tr [class.inactive]="!u.isActive">
                    <td><strong>{{ u.code }}</strong></td>
                    <td>{{ u.name }}@if (!u.isActive) { <span class="a-badge">Not offered</span> }</td>
                    <td>{{ u.roomType ? roomTypes[u.roomType] : 'Classroom' }}</td>
                    <td><button class="a-btn a-btn--sm" type="button" (click)="edit('units', u)">Edit</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="a-empty">No units yet.</td></tr>
                }
              </tbody>
            </table>
          }
        }
      </div>
    </section>

    @if (editing(); as e) {
      <div class="a-modal-backdrop" (click)="editing.set(null)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" [attr.aria-label]="'Edit ' + singular(e.kind)" (click)="$event.stopPropagation()" (ngSubmit)="save()">
          <h2>{{ e.row.id ? 'Edit' : 'New' }} {{ singular(e.kind) }}</h2>
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }
          @switch (e.kind) {
            @case ('terms') {
              <label class="a-field"><span>Name</span><input class="a-input" name="name" required maxlength="150" placeholder="e.g. September–December 2027" [(ngModel)]="e.row['name']" /></label>
              <div class="a-row">
                <label class="a-field"><span>Starts</span><input class="a-input" type="date" name="startsOn" required [(ngModel)]="e.row['startsOn']" /></label>
                <label class="a-field"><span>Ends</span><input class="a-input" type="date" name="endsOn" required [(ngModel)]="e.row['endsOn']" /></label>
              </div>
              <fieldset class="days">
                <legend class="a-label">Teaching days</legend>
                @for (d of allDays; track d) {
                  <label class="a-check"><input type="checkbox" [name]="'day' + d" [ngModel]="hasDay(e.row, d)" (ngModelChange)="toggleDay(e.row, d, $event)" /> {{ dayNames[d] }}</label>
                }
              </fieldset>
              <label class="a-field">
                <span>Start from</span>
                <select class="a-select" name="copy" [(ngModel)]="e.row['copyFromTermId']">
                  <option [ngValue]="null">A standard day (08:00–16:30, tea break and lunch)</option>
                  @for (t of terms(); track t.id) {
                    <option [ngValue]="t.id">A copy of {{ t.name }} (periods, lessons and timetable)</option>
                  }
                </select>
              </label>
            }
            @case ('rooms') {
              <label class="a-field"><span>Name</span><input class="a-input" name="name" required maxlength="100" placeholder="e.g. LR4 or Computer lab A" [(ngModel)]="e.row['name']" /></label>
              <div class="a-row">
                <label class="a-field"><span>Type</span>
                  <select class="a-select" name="type" [(ngModel)]="e.row['type']">
                    @for (k of roomTypeKeys; track k) { <option [value]="k">{{ roomTypes[k] }}</option> }
                  </select>
                </label>
                <label class="a-field"><span>Seats</span><input class="a-input" type="number" min="1" name="capacity" required [(ngModel)]="e.row['capacity']" /></label>
              </div>
              <label class="a-field"><span>Notes</span><input class="a-input" name="notes" maxlength="300" placeholder="e.g. Block B, ground floor" [(ngModel)]="e.row['notes']" /></label>
              <label class="a-check"><input type="checkbox" name="active" [(ngModel)]="e.row['isActive']" /> In use</label>
            }
            @case ('lecturers') {
              <label class="a-field"><span>Name</span><input class="a-input" name="name" required maxlength="150" [(ngModel)]="e.row['name']" /></label>
              <div class="a-row">
                <label class="a-field"><span>Email</span><input class="a-input" type="email" name="email" maxlength="255" [(ngModel)]="e.row['email']" /></label>
                <label class="a-field"><span>Department</span><input class="a-input" name="department" maxlength="150" [(ngModel)]="e.row['department']" /></label>
              </div>
              <label class="a-field"><span>Most periods a day</span><input class="a-input narrow" type="number" min="1" max="20" name="max" placeholder="No limit" [(ngModel)]="e.row['maxPeriodsPerDay']" /></label>
              <fieldset class="a-stack">
                <legend class="a-label">Times not available</legend>
                @for (u of unavail(e.row); track $index; let i = $index) {
                  <div class="a-row unavail">
                    <select class="a-select" [name]="'ud' + i" [(ngModel)]="u.day" aria-label="Day">
                      @for (d of allDays; track d) { <option [ngValue]="d">{{ dayNames[d] }}</option> }
                    </select>
                    <input class="a-input" type="time" [name]="'uf' + i" [(ngModel)]="u.from" aria-label="From" />
                    <input class="a-input" type="time" [name]="'ut' + i" [(ngModel)]="u.to" aria-label="To" />
                    <button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="unavail(e.row).splice(i, 1)">Remove</button>
                  </div>
                }
                <div><button class="a-btn a-btn--sm" type="button" (click)="unavail(e.row).push({ day: 1, from: '08:00', to: '13:00' })">+ Add a time</button></div>
              </fieldset>
              <label class="a-check"><input type="checkbox" name="active" [(ngModel)]="e.row['isActive']" /> Teaching this year</label>
            }
            @case ('classes') {
              <label class="a-field"><span>Name</span><input class="a-input" name="name" required maxlength="150" placeholder="e.g. Diploma in ICT, Sept 2026, Year 1" [(ngModel)]="e.row['name']" /></label>
              <div class="a-row">
                <label class="a-field"><span>Programme</span>
                  <select class="a-select" name="programme" [(ngModel)]="e.row['programmeId']">
                    <option [ngValue]="null">None</option>
                    @for (p of res()?.programmes ?? []; track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
                  </select>
                </label>
                <label class="a-field"><span>Students</span><input class="a-input" type="number" min="1" name="size" required [(ngModel)]="e.row['size']" /></label>
              </div>
              <label class="a-check"><input type="checkbox" name="active" [(ngModel)]="e.row['isActive']" /> Active</label>
            }
            @case ('units') {
              <div class="a-row">
                <label class="a-field code"><span>Code</span><input class="a-input" name="code" required maxlength="30" [(ngModel)]="e.row['code']" /></label>
                <label class="a-field"><span>Name</span><input class="a-input" name="name" required maxlength="200" [(ngModel)]="e.row['name']" /></label>
              </div>
              <label class="a-field"><span>Must be taught in</span>
                <select class="a-select" name="roomType" [(ngModel)]="e.row['roomType']">
                  <option [ngValue]="null">A classroom</option>
                  @for (k of roomTypeKeys; track k) {
                    @if (k !== 'classroom') { <option [ngValue]="k">A {{ roomTypes[k].toLowerCase() }}</option> }
                  }
                </select>
              </label>
              <label class="a-check"><input type="checkbox" name="active" [(ngModel)]="e.row['isActive']" /> Offered</label>
            }
          }
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
            <button class="a-btn" type="button" (click)="editing.set(null)">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .intro { max-width: 75ch; }
    .tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; border-bottom: 1px solid var(--a-line); margin-bottom: 1rem; }
    .tabs button { border: 0; background: none; padding: 0.6rem 0.9rem; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs button[aria-selected='true'] { border-bottom-color: currentColor; font-weight: 600; }
    .inactive td { opacity: 0.6; }
    .days { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; border: 0; padding: 0; margin: 0; }
    .days legend { width: 100%; margin-bottom: 0.35rem; }
    fieldset { border: 0; padding: 0; margin: 0; }
    .unavail { align-items: center; }
    .narrow { max-width: 8rem; }
    .code { flex: 0 0 9rem; }
  `,
})
export class TimetableHome {
  private readonly api = inject(TimetableApi);
  private readonly router = inject(Router);
  protected readonly tabs: Tab[] = ['terms', 'rooms', 'lecturers', 'classes', 'units'];
  protected readonly tabLabels = TAB_LABELS;
  protected readonly dayNames = DAY_NAMES;
  protected readonly allDays = [1, 2, 3, 4, 5, 6, 7];
  protected readonly roomTypes = ROOM_TYPE_LABELS;
  protected readonly roomTypeKeys = Object.keys(ROOM_TYPE_LABELS);

  protected readonly tab = signal<Tab>('terms');
  protected readonly terms = signal<Term[]>([]);
  protected readonly res = signal<Resources | null>(null);
  protected readonly editing = signal<{ kind: Tab; row: Row } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly counts = computed(() => {
    const r = this.res();
    return { terms: this.terms().length, rooms: r?.rooms.length ?? 0, lecturers: r?.lecturers.length ?? 0, classes: r?.classes.length ?? 0, units: r?.units.length ?? 0 };
  });

  constructor() {
    inject(Title).setTitle('Timetable | Admin');
    void this.load();
  }

  private async load() {
    try {
      const [terms, res] = await Promise.all([this.api.terms(), this.api.resources()]);
      this.terms.set(terms);
      this.res.set(res);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected count(t: Tab) {
    return this.counts()[t];
  }

  protected singular(t: Tab) {
    return { terms: 'term', rooms: 'room', lecturers: 'lecturer', classes: 'class', units: 'unit' }[t];
  }

  protected dayList(days: number[]) {
    return days.map((d) => DAY_SHORT[d]).join(', ');
  }

  protected programmeName(id: number | null) {
    return this.res()?.programmes.find((p) => p.id === id)?.name ?? '';
  }

  protected unavailableText(l: Lecturer) {
    return l.unavailable.map((u) => `${DAY_SHORT[u.day]} ${u.from}–${u.to}`).join(', ');
  }

  protected unavail(row: Row) {
    return row['unavailable'] as { day: number; from: string; to: string }[];
  }

  protected hasDay(row: Row, d: number) {
    return (row['days'] as number[]).includes(d);
  }

  protected toggleDay(row: Row, d: number, on: boolean) {
    const days = new Set(row['days'] as number[]);
    if (on) days.add(d);
    else days.delete(d);
    row['days'] = [...days].sort();
  }

  newRow(kind: Tab) {
    const today = new Date().toISOString().slice(0, 10);
    const rows: Record<Tab, Row> = {
      terms: { name: '', startsOn: today, endsOn: today, days: [1, 2, 3, 4, 5], copyFromTermId: this.terms()[0]?.id ?? null },
      rooms: { name: '', type: 'classroom', capacity: 40, notes: '', isActive: true },
      lecturers: { name: '', email: '', department: '', maxPeriodsPerDay: null, unavailable: [], isActive: true },
      classes: { name: '', programmeId: null, size: 30, isActive: true },
      units: { code: '', name: '', roomType: null, isActive: true },
    };
    this.error.set('');
    this.editing.set({ kind, row: rows[kind] });
  }

  edit(kind: ResourceKind, row: object) {
    const copy: Row = structuredClone(row) as Row;
    this.error.set('');
    this.editing.set({ kind, row: copy });
  }

  async save() {
    const { kind, row } = this.editing()!;
    const id = row.id ?? null;
    const body: Row = { ...row };
    delete body.id;
    for (const k of ['notes', 'email', 'department']) if (body[k] === '') body[k] = null;
    for (const k of ['capacity', 'size']) if (k in body) body[k] = Number(body[k]);
    if ('maxPeriodsPerDay' in body) body['maxPeriodsPerDay'] = body['maxPeriodsPerDay'] === null || body['maxPeriodsPerDay'] === '' ? null : Number(body['maxPeriodsPerDay']);
    this.busy.set(true);
    try {
      if (kind === 'terms') {
        const term = await this.api.createTerm(body);
        this.editing.set(null);
        await this.router.navigate(['/admin/timetable', term.id]);
        return;
      }
      await this.api.saveResource(kind, id, body);
      this.editing.set(null);
      this.notice.set(`${this.singular(kind)[0].toUpperCase() + this.singular(kind).slice(1)} saved.`);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
