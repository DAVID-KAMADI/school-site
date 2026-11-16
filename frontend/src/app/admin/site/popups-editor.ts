import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type PopupKind, type PopupRow } from '../api';
import { MediaField } from '../fields/media-field';
import { MediaCache } from '../media/media-cache';
import { toastChannel } from '../toast';

type Editable = Omit<PopupRow, 'id' | 'image' | 'createdAt' | 'updatedAt' | 'eventAt' | 'startsAt' | 'endsAt'> & {
  id?: number;
  eventAt: string;
  startsAt: string;
  endsAt: string;
  label: string;
  buttonLabel: string;
  buttonLink: string;
};

const KINDS: { value: PopupKind; label: string; hint: string }[] = [
  { value: 'event', label: 'Upcoming event', hint: 'Open days, graduations, sports days. Add the date and it shows a countdown.' },
  { value: 'offer', label: 'Special offer', hint: 'Fee discounts, scholarships, early-bird deals.' },
  { value: 'course', label: 'New course', hint: 'A new programme or short course.' },
  { value: 'news', label: 'News', hint: 'Results, achievements, important notices.' },
  { value: 'announcement', label: 'Announcement', hint: 'Anything else.' },
];

/** Website pop-ups for events, offers, new courses and news. Shown with any open intake pop-ups; visitors swipe between them. */
@Component({
  selector: 'app-popups-editor',
  imports: [FormsModule, DatePipe, RouterLink, MediaField],
  template: `
    <div class="a-toolbar a-toolbar--spread">
      <div>
        <h1>Pop-ups</h1>
        <p class="a-muted">
          Announce upcoming events, offers and new courses. Every pop-up that is switched on shows when someone opens the website (Priority ones first),
          together with the pop-ups of open intakes (set in <a routerLink="/admin/admissions-setup">Admissions setup → Intakes</a>).
          With more than one, visitors swipe left or right, or use the arrows, to see them all.
        </p>
      </div>
      <button class="a-btn a-btn--primary" type="button" (click)="create()">+ New pop-up</button>
    </div>

    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Order</th><th>Pop-up</th><th>Type</th><th>Shown</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <td>{{ p.sortOrder }}</td>
              <td>@if (p.isPriority) {<span class="a-badge priority">Priority</span> }<strong>{{ p.title }}</strong>@if (p.eventAt) {<br /><span class="a-small a-muted">Event: {{ p.eventAt | date: 'EEE d MMM y, HH:mm' }}</span>}</td>
              <td>{{ p.label || kindLabel(p.kind) }}</td>
              <td class="a-small">{{ window(p) }}</td>
              <td><span class="a-badge" [class.a-badge--live]="status(p) === 'Showing now'">{{ status(p) }}</span></td>
              <td class="actions">
                <button class="a-btn a-btn--sm" type="button" (click)="edit(p)">Edit</button>
                <button class="a-btn a-btn--sm" type="button" (click)="toggle(p)">{{ p.isActive ? 'Switch off' : 'Switch on' }}</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="a-empty">No pop-ups yet. Create one for your next event, offer or new course.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (editing(); as e) {
      <div class="a-modal-backdrop" (click)="editing.set(null)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-label="Edit pop-up" (click)="$event.stopPropagation()" (ngSubmit)="save()">
          <h2>{{ e.id ? 'Edit pop-up' : 'New pop-up' }}</h2>
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }
          <div class="a-row">
            <label class="a-field"><span>Type</span>
              <select class="a-select" name="kind" [(ngModel)]="e.kind">
                @for (k of kinds; track k.value) {<option [value]="k.value">{{ k.label }}</option>}
              </select>
            </label>
            <label class="a-field"><span>Label above the title <small class="a-muted">(optional)</small></span>
              <input class="a-input" name="label" maxlength="60" [placeholder]="'e.g. ' + kindLabel(e.kind)" [(ngModel)]="e.label" />
            </label>
          </div>
          <p class="a-small a-muted hint">{{ kindHint(e.kind) }}</p>
          <label class="a-field"><span>Title</span><input class="a-input" name="title" maxlength="120" required placeholder="e.g. Open day this Saturday" [(ngModel)]="e.title" /></label>
          <label class="a-field"><span>Details</span><textarea class="a-textarea" name="details" maxlength="2000" required placeholder="What it is, who it is for, and what visitors should do next." [(ngModel)]="e.details"></textarea></label>
          <div class="a-field"><span class="a-label">Photo <small class="a-muted">(optional: without one, the pop-up uses the college colours and an icon)</small></span><app-media-field [(value)]="e.imageId" kind="image" /></div>
          @if (e.kind === 'event') {
            <label class="a-field"><span>Event date and time</span><input class="a-input" type="datetime-local" name="eventAt" [(ngModel)]="e.eventAt" /></label>
          }
          <div class="a-row">
            <label class="a-field"><span>Button text <small class="a-muted">(optional)</small></span><input class="a-input" name="buttonLabel" maxlength="40" placeholder="e.g. Book a place" [(ngModel)]="e.buttonLabel" /></label>
            <label class="a-field"><span>Button goes to</span><input class="a-input" name="buttonLink" maxlength="500" placeholder="/courses or https://…" [(ngModel)]="e.buttonLink" /></label>
          </div>
          <div class="a-row">
            <label class="a-field"><span>Show from <small class="a-muted">(empty: now)</small></span><input class="a-input" type="datetime-local" name="startsAt" [(ngModel)]="e.startsAt" /></label>
            <label class="a-field"><span>Show until <small class="a-muted">(empty: {{ e.kind === 'event' ? 'until the event starts' : 'until switched off' }})</small></span><input class="a-input" type="datetime-local" name="endsAt" [(ngModel)]="e.endsAt" /></label>
          </div>
          <div class="a-row">
            <label class="a-field order"><span>Order <small class="a-muted">(lower shows first)</small></span><input class="a-input" type="number" name="sortOrder" min="0" max="9999" [(ngModel)]="e.sortOrder" /></label>
          </div>
          <label class="a-check"><input type="checkbox" name="isActive" [(ngModel)]="e.isActive" /> Show this pop-up on the website</label>
          <label class="a-check"><input type="checkbox" name="isPriority" [(ngModel)]="e.isPriority" /> Priority: show this first, before the intake pop-ups and the rest</label>
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="saving()">Save</button>
            <button class="a-btn" type="button" (click)="editing.set(null)">Cancel</button>
            @if (e.id) {
              <button class="a-btn a-btn--danger" type="button" (click)="remove(e)">Delete</button>
            }
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .a-toolbar--spread { align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .a-toolbar--spread p { max-width: 60rem; }
    .actions { display: flex; gap: 0.4rem; justify-content: flex-end; }
    .hint { margin-top: -0.5rem; }
    .order { flex: 0 0 14rem; }
    .priority { margin-right: 0.4rem; background: var(--a-accent, #ef6d00); color: #fff; }
  `,
})
export class PopupsEditor {
  private readonly api = inject(AdminApi);
  private readonly mediaCache = inject(MediaCache);
  protected readonly message = toastChannel();
  protected readonly rows = signal<PopupRow[]>([]);
  protected readonly editing = signal<Editable | null>(null);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly kinds = KINDS;

  constructor() {
    inject(Title).setTitle('Pop-ups | Admin');
    void this.load();
  }

  private async load() {
    try {
      const rows = await this.api.popups();
      this.mediaCache.add(...rows.map((r) => r.image));
      this.rows.set(rows);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected kindLabel(kind: PopupKind) {
    return KINDS.find((k) => k.value === kind)?.label ?? kind;
  }

  protected kindHint(kind: PopupKind) {
    return KINDS.find((k) => k.value === kind)?.hint ?? '';
  }

  protected window(p: PopupRow) {
    const d = (v: string) => new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const until = p.endsAt ? d(p.endsAt) : p.eventAt ? `event (${d(p.eventAt)})` : 'switched off';
    return `${p.startsAt ? d(p.startsAt) : 'Now'} → ${until}`;
  }

  /** Mirrors the API's rule for what the website shows. */
  protected status(p: PopupRow) {
    if (!p.isActive) return 'Off';
    const now = Date.now();
    if (p.startsAt && new Date(p.startsAt).getTime() > now) return 'Scheduled';
    const end = p.endsAt ?? p.eventAt;
    if (end && new Date(end).getTime() < now) return 'Ended';
    return 'Showing now';
  }

  create() {
    this.error.set('');
    this.editing.set({
      kind: 'event',
      label: '',
      title: '',
      details: '',
      imageId: null,
      eventAt: '',
      buttonLabel: '',
      buttonLink: '',
      startsAt: '',
      endsAt: '',
      isActive: true,
      isPriority: false,
      sortOrder: this.rows().length ? Math.max(...this.rows().map((r) => r.sortOrder)) + 1 : 0,
    });
  }

  edit(p: PopupRow) {
    this.error.set('');
    this.editing.set(toEditable(p));
  }

  async save() {
    const e = this.editing();
    if (!e) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.api.savePopup(e.id ?? null, this.body(e));
      this.editing.set(null);
      this.message.set({ kind: 'success', text: 'Pop-up saved. The website shows the change on the next visit.' });
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(p: PopupRow) {
    try {
      await this.api.savePopup(p.id, { ...this.body(toEditable(p)), isActive: !p.isActive });
      this.message.set({ kind: 'success', text: `"${p.title}" ${p.isActive ? 'switched off' : 'switched on'}.` });
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async remove(e: Editable) {
    if (!e.id || !confirm(`Delete the pop-up "${e.title}"? This cannot be undone. To hide it for now, untick "Show this pop-up on the website" instead.`)) return;
    try {
      await this.api.deletePopup(e.id);
      this.editing.set(null);
      this.message.set({ kind: 'success', text: `Pop-up "${e.title}" deleted.` });
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private body(e: Editable) {
    const iso = (v: string) => (v ? new Date(v).toISOString() : null);
    return {
      kind: e.kind,
      label: e.label.trim() || null,
      title: e.title,
      details: e.details,
      imageId: e.imageId,
      eventAt: e.kind === 'event' ? iso(e.eventAt) : null,
      buttonLabel: e.buttonLabel.trim() || null,
      buttonLink: e.buttonLink.trim() || null,
      startsAt: iso(e.startsAt),
      endsAt: iso(e.endsAt),
      isActive: e.isActive,
      isPriority: e.isPriority,
      sortOrder: Number(e.sortOrder) || 0,
    };
  }
}

function toEditable(p: PopupRow): Editable {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label ?? '',
    title: p.title,
    details: p.details,
    imageId: p.imageId,
    eventAt: localInput(p.eventAt),
    buttonLabel: p.buttonLabel ?? '',
    buttonLink: p.buttonLink ?? '',
    startsAt: localInput(p.startsAt),
    endsAt: localInput(p.endsAt),
    isActive: p.isActive,
    isPriority: p.isPriority,
    sortOrder: p.sortOrder,
  };
}

/** A date for a datetime-local input, in the browser's time zone. */
function localInput(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
