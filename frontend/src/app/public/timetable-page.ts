import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SiteStore } from '../core/site';
import { buildGrid, DAY_NAMES, type GridItem, type GridPeriod } from '../core/timetable';

interface PublicTerm {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
}
interface PublicSession {
  day: number;
  startPeriodId: number;
  length: number;
  unitCode: string;
  unitName: string;
  lecturerId: number;
  classIds: number[];
  roomId: number;
}
interface PublicTimetable {
  term: PublicTerm & { days: number[]; publishedAt: string };
  periods: GridPeriod[];
  classes: { id: number; name: string }[];
  lecturers: { id: number; name: string }[];
  rooms: { id: number; name: string }[];
  sessions: PublicSession[];
}
type View = 'class' | 'lecturer' | 'room';

/**
 * Published timetables: choose a term, then a class, lecturer or room. The choice is kept in the
 * address (?term=…&class=…), so a class rep can share a link to their class's timetable. Prints cleanly.
 */
@Component({
  selector: 'app-timetable-page',
  imports: [FormsModule],
  template: `
    <section class="container tt">
      <h1>{{ site.t('timetable.title', 'Timetables') }}</h1>
      @if (terms() === null) {
        <p class="muted">…</p>
      } @else if (!terms()!.length) {
        <p>{{ site.t('timetable.none', 'No timetable has been published yet.') }}</p>
      } @else {
        <p class="intro no-print">{{ site.t('timetable.intro', 'Choose your class to see when and where each lesson takes place.') }}</p>
        <form class="pickers no-print" (submit)="$event.preventDefault()">
          @if (terms()!.length > 1) {
            <label>
              <span>{{ site.t('timetable.term', 'Term') }}</span>
              <select [ngModel]="termId()" name="term" (ngModelChange)="go({ term: $event, id: null })">
                @for (t of terms(); track t.id) {
                  <option [ngValue]="t.id">{{ t.name }}</option>
                }
              </select>
            </label>
          }
          <fieldset class="seg">
            <legend>{{ site.t('timetable.view_by', 'View by') }}</legend>
            @for (v of views; track v) {
              <label [class.on]="view() === v">
                <input type="radio" name="view" [value]="v" [ngModel]="view()" (ngModelChange)="go({ view: $event, id: null })" />
                {{ viewLabel(v) }}
              </label>
            }
          </fieldset>
          <label class="grow">
            <span>{{ viewLabel(view()) }}</span>
            <select [ngModel]="itemId()" name="item" (ngModelChange)="go({ id: $event })">
              <option [ngValue]="null">{{ site.t('timetable.choose', 'Choose…') }}</option>
              @for (c of choices(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          @if (itemId() !== null) {
            <button type="button" class="btn btn--primary" (click)="print()">{{ site.t('timetable.print', 'Print') }}</button>
          }
        </form>

        @if (data(); as d) {
          @if (itemId() !== null) {
            <h2 class="sub">{{ chosenName() }} <small>· {{ d.term.name }}</small></h2>
            @if (!items().length) {
              <p>{{ site.t('timetable.empty', 'Nothing is scheduled for this choice.') }}</p>
            } @else {
              <div class="table-wrap">
                <table class="grid">
                  <thead>
                    <tr>
                      <th scope="col" class="time">{{ site.t('timetable.time', 'Time') }}</th>
                      @for (day of d.term.days; track day) {
                        <th scope="col">{{ dayNames[day] }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of grid(); track row.period.id) {
                      @if (row.period.isBreak) {
                        <tr class="break">
                          <th scope="row" class="time">{{ row.period.startsAt }}–{{ row.period.endsAt }}</th>
                          <td [attr.colspan]="d.term.days.length">{{ row.period.label }}</td>
                        </tr>
                      } @else {
                        <tr>
                          <th scope="row" class="time">{{ row.period.startsAt }}–{{ row.period.endsAt }}</th>
                          @for (cell of row.cells; track $index) {
                            @if (cell.kind === 'item') {
                              @let s = cell.item.data;
                              <td [attr.rowspan]="cell.rowspan" class="lesson">
                                <strong>{{ s.unitCode }}</strong>
                                <span class="name">{{ s.unitName }}</span>
                                @for (line of detail(s); track $index) {
                                  <span>{{ line }}</span>
                                }
                              </td>
                            } @else if (cell.kind === 'empty') {
                              <td></td>
                            }
                          }
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        }
      }
    </section>
  `,
  styles: `
    .tt { padding-block: var(--section-space); }
    .intro { color: var(--muted); max-width: 60ch; }
    .pickers { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem; margin: 1.25rem 0 1.5rem; }
    .pickers label { display: grid; gap: 0.3rem; font-weight: 600; font-size: 0.92rem; }
    .pickers select { min-height: 2.75rem; padding: 0.4rem 0.6rem; border: 1px solid var(--line); border-radius: var(--radius-sm); font: inherit; background: var(--surface); min-width: 12rem; }
    .grow { flex: 1 1 16rem; }
    .grow select { width: 100%; }
    .seg { display: flex; gap: 0.25rem; border: 0; margin: 0; padding: 0; }
    .seg legend { font-weight: 600; font-size: 0.92rem; margin-bottom: 0.3rem; padding: 0; }
    .seg label { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0 0.9rem; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; font-weight: 500; }
    .seg label.on { background: var(--action); border-color: var(--action); color: #fff; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg label:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
    .sub { margin: 0 0 1rem; font-size: 1.35rem; }
    .sub small { color: var(--muted); font-weight: 400; font-size: 1rem; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }
    .grid { width: 100%; min-width: 640px; border-collapse: collapse; table-layout: fixed; font-size: 0.9rem; }
    .grid th, .grid td { border: 1px solid var(--line); vertical-align: top; text-align: left; padding: 0.45rem 0.5rem; }
    .grid thead th { background: var(--surface-2); }
    .grid .time { width: 7rem; font-weight: 500; color: var(--muted); white-space: nowrap; background: var(--surface-2); }
    .grid tbody tr { height: 3.4rem; }
    .lesson { background: #eaf1ff; }
    .lesson strong, .lesson span { display: block; line-height: 1.3; }
    .lesson .name { font-size: 0.85rem; }
    .lesson span:not(.name) { font-size: 0.8rem; color: var(--muted); }
    .break td { text-align: center; font-size: 0.8rem; color: var(--muted); background: var(--surface-3); }
    .break { height: auto !important; }
    @media print {
      .tt { padding: 0; }
      .table-wrap { overflow: visible; border: 0; }
      .grid { min-width: 0; font-size: 9pt; }
      .lesson { background: #eef3ff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `,
})
export class TimetablePage {
  protected readonly site = inject(SiteStore);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly dayNames = DAY_NAMES;
  protected readonly views: View[] = ['class', 'lecturer', 'room'];

  protected readonly terms = signal<PublicTerm[] | null>(null);
  protected readonly data = signal<PublicTimetable | null>(null);
  private readonly params = signal<Record<string, string>>({});

  protected readonly termId = computed(() => Number(this.params()['term']) || this.terms()?.[0]?.id || null);
  protected readonly view = computed<View>(() => {
    const p = this.params();
    return p['lecturer'] ? 'lecturer' : p['room'] ? 'room' : p['view'] === 'lecturer' || p['view'] === 'room' ? (p['view'] as View) : 'class';
  });
  protected readonly itemId = computed(() => Number(this.params()[this.view()]) || null);

  protected readonly choices = computed(() => {
    const d = this.data();
    if (!d) return [];
    return this.view() === 'class' ? d.classes : this.view() === 'lecturer' ? d.lecturers : d.rooms;
  });
  protected readonly chosenName = computed(() => this.choices().find((c) => c.id === this.itemId())?.name ?? '');

  protected readonly items = computed<GridItem<PublicSession>[]>(() => {
    const d = this.data();
    const id = this.itemId();
    if (!d || id === null) return [];
    const view = this.view();
    return d.sessions
      .filter((s) => (view === 'class' ? s.classIds.includes(id) : view === 'lecturer' ? s.lecturerId === id : s.roomId === id))
      .map((s) => ({ day: s.day, startPeriodId: s.startPeriodId, length: s.length, data: s }));
  });
  protected readonly grid = computed(() => {
    const d = this.data();
    return d ? buildGrid(d.periods, d.term.days, this.items()) : [];
  });

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    this.route.queryParams.subscribe((p) => this.params.set(p));
    void firstValueFrom(this.http.get<PublicTerm[]>('/api/v1/public/timetable'))
      .then((t) => this.terms.set(t))
      .catch(() => this.terms.set([]));
    effect(() => {
      const id = this.termId();
      if (id === null || this.data()?.term.id === id) return;
      void firstValueFrom(this.http.get<PublicTimetable>(`/api/v1/public/timetable/${id}`))
        .then((d) => this.data.set(d))
        .catch(() => this.data.set(null));
    });
    effect(() => {
      const heading = this.site.t('timetable.title', 'Timetables');
      const name = this.chosenName();
      const page = name ? `${name} — ${heading}` : heading;
      title.setTitle(`${page} | ${this.site.institutionName()}`);
      meta.updateTag({ name: 'description', content: this.site.t('timetable.intro', 'Choose your class to see when and where each lesson takes place.') });
    });
  }

  protected viewLabel(v: View) {
    return v === 'class' ? this.site.t('timetable.class', 'Class') : v === 'lecturer' ? this.site.t('timetable.lecturer', 'Lecturer') : this.site.t('timetable.room', 'Room');
  }

  /** The lines under a lesson: whatever the chosen view does not already say. */
  protected detail(s: PublicSession) {
    const d = this.data()!;
    const classes = s.classIds.map((id) => d.classes.find((c) => c.id === id)?.name ?? '').join(' + ');
    const lecturer = d.lecturers.find((l) => l.id === s.lecturerId)?.name ?? '';
    const room = d.rooms.find((r) => r.id === s.roomId)?.name ?? '';
    return this.view() === 'class' ? [lecturer, room] : this.view() === 'lecturer' ? [classes, room] : [classes, lecturer];
  }

  /** Keeps the choice in the address so it can be bookmarked or shared. */
  protected go(change: { term?: number; view?: View; id?: number | null }) {
    const view = change.view ?? this.view();
    const id = change.id === undefined ? this.itemId() : change.id;
    const term = change.term ?? this.termId();
    const queryParams: Record<string, string | number | null> = { term, view: null, class: null, lecturer: null, room: null };
    if (id) queryParams[view] = id;
    else if (view !== 'class') queryParams['view'] = view;
    void this.router.navigate([], { queryParams, replaceUrl: true });
  }

  protected print() {
    window.print();
  }
}
