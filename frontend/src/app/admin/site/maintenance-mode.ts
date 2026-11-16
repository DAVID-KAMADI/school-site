import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type MaintenanceMode } from '../api';
import { toastChannel } from '../toast';

/** "YYYY-MM-DDTHH:mm" in local time, for a datetime-local input. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Maintenance mode: while it is on, visitors see a "we'll be back soon" page with a countdown to the
 * time set here. Staff who are signed in keep seeing the site (with a reminder strip) and the admin.
 */
@Component({
  selector: 'app-maintenance-mode',
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Maintenance mode</h1>
    <p class="a-muted intro">
      Switch this on while the site is being updated. Visitors then see a maintenance page with a countdown to the time you
      set, and it refreshes by itself once you switch it off. Search engines are told the site is only temporarily away.
      You (and other signed-in staff) keep seeing the normal site and the admin, so you can check your changes.
    </p>

    @if (current(); as c) {
      <section class="a-panel state" [class.state--on]="c.active">
        <div>
          <h2>
            @if (c.active) {
              <span class="a-badge on">On</span> Visitors see the maintenance page
            } @else {
              <span class="a-badge">Off</span> The site is open to everyone
            }
          </h2>
          @if (c.active && c.endsAt) {
            <p class="a-small">
              Expected back {{ c.endsAt | date: 'EEE d MMM, HH:mm' }}{{ c.autoEnd ? ' (switches off by itself then)' : '' }}.
            </p>
          }
          @if (c.restoring) {
            <p class="a-small">A backup restore is running: the maintenance page is showing until it finishes.</p>
          }
        </div>
        <a class="a-btn" href="/?maintenance-preview=1" target="_blank" rel="noopener">Preview the page</a>
      </section>

      <form class="a-panel a-stack" (ngSubmit)="save(!c.active)">
        <label class="a-field">
          <span>Heading</span>
          <input class="a-input" name="title" maxlength="120" [(ngModel)]="title" placeholder="We're making the site better" />
        </label>
        <label class="a-field">
          <span>Message</span>
          <textarea class="a-textarea" name="message" maxlength="600" rows="3" [(ngModel)]="text"
            placeholder="We're carrying out planned updates. Thank you for your patience. Please check back soon."></textarea>
          <span class="a-help">Leave either empty to use the standard wording (Interface text → maintenance.*).</span>
        </label>

        <div class="a-field">
          <span class="a-label">Back by</span>
          <div class="a-row when">
            <input class="a-input" type="datetime-local" name="endsAt" [(ngModel)]="endsAt" [min]="minEnd" />
            <button type="button" class="a-btn" (click)="addMinutes(30)">+30 min</button>
            <button type="button" class="a-btn" (click)="addMinutes(60)">+1 hour</button>
            <button type="button" class="a-btn" (click)="addMinutes(120)">+2 hours</button>
            @if (endsAt) {
              <button type="button" class="a-btn" (click)="endsAt = ''; autoEnd = false">No time</button>
            }
          </div>
          <span class="a-help">Shown as a countdown. Without a time the page just says it will be back shortly.</span>
        </div>

        <label class="a-check">
          <input type="checkbox" name="autoEnd" [(ngModel)]="autoEnd" [disabled]="!endsAt" />
          Switch off by itself at that time
        </label>
        <p class="a-help">
          If left unticked, the page says "almost done" when the countdown reaches zero, until you switch it off. Updates often
          take a little longer than planned.
        </p>

        <div class="a-row">
          @if (c.active) {
            <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">Switch off: open the site</button>
            <button class="a-btn" type="button" [disabled]="busy()" (click)="save(true)">Save changes</button>
          } @else {
            <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">Switch on maintenance mode</button>
            <button class="a-btn" type="button" [disabled]="busy()" (click)="save(false)">Save without switching on</button>
          }
        </div>
      </form>
    }
  `,
  styles: `
    .intro { max-width: 75ch; }
    .state { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
    .state h2 { margin: 0; font-size: 1.1rem; display: flex; gap: 0.5rem; align-items: center; }
    .state p { margin: 0.35rem 0 0; }
    .state--on { border: 2px solid var(--a-warning); }
    .on { background: var(--a-warning-soft); color: var(--a-warning); }
    .when { flex-wrap: wrap; align-items: center; }
    .when .a-input { max-width: 15rem; }
  `,
})
export class MaintenanceModeEditor {
  private readonly api = inject(AdminApi);
  protected readonly current = signal<(MaintenanceMode & { active: boolean; restoring: boolean }) | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = toastChannel();
  protected readonly minEnd = localInput(new Date());

  protected title = '';
  protected text = '';
  protected endsAt = '';
  protected autoEnd = false;

  constructor() {
    inject(Title).setTitle('Maintenance mode | Admin');
    void this.load();
  }

  private async load() {
    try {
      this.fill(await this.api.maintenance());
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  private fill(m: MaintenanceMode & { active: boolean; restoring?: boolean }) {
    this.current.set({ restoring: false, ...m });
    this.title = m.title;
    this.text = m.message;
    this.endsAt = m.endsAt ? localInput(new Date(m.endsAt)) : '';
    this.autoEnd = m.autoEnd;
  }

  /** From the chosen time if it is still ahead, otherwise from now. */
  protected addMinutes(n: number) {
    const base = this.endsAt && new Date(this.endsAt).getTime() > Date.now() ? new Date(this.endsAt) : new Date();
    this.endsAt = localInput(new Date(base.getTime() + n * 60_000));
  }

  async save(enabled: boolean) {
    const end = this.endsAt ? new Date(this.endsAt) : null;
    if (enabled && end && end.getTime() <= Date.now()) {
      this.message.set({ kind: 'error', text: 'Choose a "back by" time in the future, or use "No time".' });
      return;
    }
    this.busy.set(true);
    this.message.set(null);
    try {
      const saved = await this.api.saveMaintenance({
        enabled,
        title: this.title,
        message: this.text,
        endsAt: end ? end.toISOString() : null,
        autoEnd: !!end && this.autoEnd,
      });
      const wasOn = this.current()?.active;
      this.fill({ ...saved, restoring: this.current()?.restoring ?? false });
      this.message.set({
        kind: 'success',
        text: saved.active
          ? wasOn
            ? 'Saved. Visitors see the updated maintenance page within a few seconds.'
            : 'Maintenance mode is on. Visitors now see the maintenance page; you still see the site.'
          : wasOn
            ? 'Maintenance mode is off. The site is open again; visitors on the maintenance page are taken back within 20 seconds.'
            : 'Saved. Maintenance mode is still off.',
      });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }
}
