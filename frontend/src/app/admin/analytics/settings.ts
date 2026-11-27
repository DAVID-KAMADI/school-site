import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api-url.interceptor';
import { toastChannel } from '../toast';
import { AnalyticsStore, when, type CustomEventRule, type FunnelStep, type Goal, type Settings, type SettingsResponse } from './analytics-data';
import { EVENT_HELP } from './events';
import { Skeleton, TAB_STYLES } from './shared';

const blankGoal = (): Partial<Goal> => ({ name: '', eventName: '', labelContains: '', isActive: true });

/** Web analytics → Settings: tracking on/off, privacy, retention, goals, custom events, funnels. */
@Component({
  selector: 'app-analytics-settings',
  imports: [FormsModule, Skeleton],
  template: `
    @if (loadError()) {
      <p class="a-alert a-alert--error" role="alert">{{ loadError() }}</p>
    }
    @if (draft(); as s) {
      <form class="grid" (ngSubmit)="save()">
        <section class="a-panel a-stack">
          <h2>Tracking and privacy</h2>
          <label class="a-check"><input type="checkbox" [(ngModel)]="s.enabled" name="enabled" /> Count visits to the website</label>
          <label class="a-check"><input type="checkbox" [(ngModel)]="s.excludeStaff" name="excludeStaff" /> Don't count staff signed in to this portal</label>
          <label class="a-check"><input type="checkbox" [(ngModel)]="s.respectDoNotTrack" name="dnt" /> Don't count browsers that ask not to be tracked (Do Not Track / Global Privacy Control)</label>
          <div class="a-row">
            <div class="a-field">
              <label for="an-ret">Keep visit records for</label>
              <select id="an-ret" class="a-input" [(ngModel)]="s.retentionMonths" name="retention">
                @for (m of retention; track m) {
                  <option [ngValue]="m">{{ m }} months</option>
                }
              </select>
              <p class="a-help">Older visits are deleted every night.</p>
            </div>
            <div class="a-field">
              <label for="an-ips">Addresses not to count</label>
              <textarea id="an-ips" class="a-textarea" rows="3" [(ngModel)]="ipsText" name="ips" placeholder="e.g. 41.90.12.34 or 192.168.1.0/24"></textarea>
              <p class="a-help">The office or test computers. One per line.</p>
            </div>
          </div>
          <p class="a-help">
            What's stored: pages, time on page, approximate country and city, device, browser and how people found the site.
            Never IP addresses, form contents or query strings. Visitors who chose "Essential only" cookies are counted without anything being stored on their device.
          </p>
        </section>

        <section class="a-panel a-stack">
          <div class="panel-head">
            <div><h2>Custom events</h2><p class="a-small a-muted">Track clicks or visits without changing the website's code.</p></div>
            <button type="button" class="a-btn a-btn--sm" (click)="addRule()">Add event</button>
          </div>
          @for (r of s.customEvents; track $index; let i = $index) {
            <div class="line">
              <input class="a-input" [(ngModel)]="r.name" [name]="'ce-name-' + i" placeholder="event_name" aria-label="Event name" />
              <select class="a-input" [(ngModel)]="r.type" [name]="'ce-type-' + i" aria-label="When">
                <option value="link">Click on a link containing</option>
                <option value="click">Click on elements matching (CSS)</option>
                <option value="page">Visit to pages starting with</option>
              </select>
              <input class="a-input" [(ngModel)]="r.value" [name]="'ce-val-' + i" [placeholder]="r.type === 'page' ? '/courses' : r.type === 'link' ? 'brochure.pdf' : '.apply-button'" aria-label="Value" />
              <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="s.customEvents.splice(i, 1)" aria-label="Remove event">Remove</button>
            </div>
          } @empty {
            <p class="a-muted a-small">None. Downloads, contact clicks, outbound links, sign-ups and submitted applications are tracked automatically.</p>
          }
        </section>

        <section class="a-panel a-stack">
          <div class="panel-head">
            <div><h2>Funnels</h2><p class="a-small a-muted">Steps visitors should take in order, e.g. apply page → account → application.</p></div>
            <button type="button" class="a-btn a-btn--sm" (click)="addFunnel()">Add funnel</button>
          </div>
          @for (f of s.funnels; track $index; let i = $index) {
            <fieldset class="funnel">
              <div class="line">
                <input class="a-input" [(ngModel)]="f.name" [name]="'f-name-' + i" placeholder="Funnel name" aria-label="Funnel name" />
                <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="s.funnels.splice(i, 1)">Remove funnel</button>
              </div>
              @for (st of f.steps; track $index; let j = $index) {
                <div class="line step">
                  <span class="a-muted">{{ j + 1 }}.</span>
                  <select class="a-input" [(ngModel)]="st.type" [name]="'f-' + i + '-t-' + j" aria-label="Step type">
                    <option value="page">Page</option>
                    <option value="event">Event</option>
                  </select>
                  <input class="a-input" [(ngModel)]="st.value" [name]="'f-' + i + '-v-' + j" [attr.list]="st.type === 'event' ? 'an-events' : null" [placeholder]="st.type === 'page' ? '/apply' : 'sign_up'" aria-label="Page or event" />
                  <input class="a-input" [(ngModel)]="st.label" [name]="'f-' + i + '-l-' + j" placeholder="Label (optional)" aria-label="Label" />
                  <button type="button" class="a-btn a-btn--sm" [disabled]="f.steps.length <= 2" (click)="f.steps.splice(j, 1)" aria-label="Remove step">✕</button>
                </div>
              }
              @if (f.steps.length < 8) {
                <button type="button" class="a-link-btn a-small" (click)="f.steps.push(newStep())">+ Add step</button>
              }
            </fieldset>
          }
        </section>

        <div class="a-toolbar save">
          <button type="submit" class="a-btn a-btn--primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save settings' }}</button>
        </div>
      </form>

      <section class="a-panel a-stack goals">
        <div class="panel-head">
          <div><h2>Goals</h2><p class="a-small a-muted">An event that counts as a conversion, at most once per visit. Saved straight away.</p></div>
        </div>
        <div class="a-table-wrap">
          <table class="a-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Event</th><th scope="col">Only when detail contains</th><th scope="col">Active</th><th scope="col"></th></tr></thead>
            <tbody>
              @for (g of goals(); track g.id ?? $index; let i = $index) {
                <tr>
                  <td><input class="a-input" [(ngModel)]="g.name" [name]="'g-n-' + i" aria-label="Goal name" /></td>
                  <td><input class="a-input" [(ngModel)]="g.eventName" [name]="'g-e-' + i" list="an-events" aria-label="Event" placeholder="file_download" /></td>
                  <td><input class="a-input" [(ngModel)]="g.labelContains" [name]="'g-l-' + i" aria-label="Detail contains" placeholder="optional, e.g. .pdf" /></td>
                  <td><input type="checkbox" [(ngModel)]="g.isActive" [name]="'g-a-' + i" aria-label="Active" /></td>
                  <td class="actions">
                    <button type="button" class="a-btn a-btn--sm a-btn--primary" (click)="saveGoal(g)">Save</button>
                    @if (g.id) {
                      <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="removeGoal(g)">Delete</button>
                    } @else {
                      <button type="button" class="a-btn a-btn--sm" (click)="goals.set(goals().slice(0, -1))">Cancel</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (!adding()) {
          <div><button type="button" class="a-btn a-btn--sm" (click)="goals.set([...goals(), blank()])">Add goal</button></div>
        }
      </section>

      <section class="a-panel a-stack">
        <h2>Location database</h2>
        @if (geo(); as g) {
          <p class="a-small">
            @if (g.available) {
              Installed{{ g.updatedAt ? ', updated ' + when(g.updatedAt) : '' }}{{ g.sizeMb ? ' (' + g.sizeMb + ' MB)' : '' }}. It updates itself every month.
            } @else if (g.downloading) {
              Downloading… countries and cities appear for new visits once it's done.
            } @else {
              Not installed yet: visits are counted without country or city.
            }
          </p>
          @if (g.lastError) {
            <p class="a-alert a-alert--warning">Last download failed: {{ g.lastError }}</p>
          }
          <div><button type="button" class="a-btn a-btn--sm" [disabled]="g.downloading" (click)="updateGeo()">{{ g.downloading ? 'Downloading…' : 'Download latest now' }}</button></div>
        }
        <p class="a-help">Free “IP to City Lite” database from DB-IP (CC BY 4.0), kept on this server: addresses are looked up here, never sent anywhere.</p>
      </section>

      <datalist id="an-events">
        @for (e of eventNames; track e) {
          <option [value]="e"></option>
        }
      </datalist>
    } @else if (!loadError()) {
      <an-skeleton [height]="400" />
    }
  `,
  styles: TAB_STYLES + `
    .line { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .line .a-input { flex: 1 1 10rem; width: auto; }
    .line select.a-input { flex: 0 1 15rem; }
    .step { padding-left: 0.5rem; }
    .step select.a-input { flex: 0 1 7rem; }
    fieldset.funnel { border: 1px solid var(--a-line); border-radius: var(--a-radius-sm); padding: 0.85rem; display: grid; gap: 0.5rem; margin: 0; }
    .save { justify-content: flex-end; }
    .goals { margin-top: 1rem; }
    .goals td .a-input { min-width: 9rem; }
    .actions { white-space: nowrap; display: flex; gap: 0.4rem; }
  `,
})
export class AnalyticsSettings {
  private readonly store = inject(AnalyticsStore);
  private readonly toast = toastChannel();
  protected readonly retention = [3, 6, 12, 13, 18, 24, 36];
  protected readonly eventNames = Object.keys(EVENT_HELP);
  protected readonly when = when;
  protected readonly draft = signal<Settings | null>(null);
  protected readonly goals = signal<Partial<Goal>[]>([]);
  protected readonly geo = signal<SettingsResponse['geo'] | null>(null);
  protected readonly saving = signal(false);
  protected readonly loadError = signal('');
  protected readonly adding = computed(() => this.goals().some((g) => !g.id));
  protected ipsText = '';
  protected blank = blankGoal;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const r = await this.store.settings();
      const s = structuredClone(r.settings);
      if (!this.retention.includes(s.retentionMonths)) this.retention.push(s.retentionMonths);
      this.draft.set(s);
      this.ipsText = s.excludedIps.join('\n');
      this.goals.set(r.goals.map((g) => ({ ...g, labelContains: g.labelContains ?? '' })));
      this.geo.set(r.geo);
    } catch (e) {
      this.loadError.set(errorMessage(e));
    }
  }

  protected addRule() {
    this.draft()!.customEvents.push({ name: '', type: 'link', value: '' } as CustomEventRule);
  }

  protected addFunnel() {
    this.draft()!.funnels.push({ name: '', steps: [this.newStep(), this.newStep()] });
  }

  protected newStep(): FunnelStep {
    return { type: 'page', value: '', label: '' };
  }

  protected async save() {
    const s = this.draft();
    if (!s) return;
    this.saving.set(true);
    try {
      const saved = await this.store.saveSettings({ ...s, excludedIps: this.ipsText.split(/[\s,]+/).filter(Boolean) });
      this.draft.set(structuredClone(saved));
      this.ipsText = saved.excludedIps.join('\n');
      this.toast.set({ kind: 'success', text: 'Analytics settings saved.' });
    } catch (e) {
      this.toast.set({ kind: 'error', text: errorMessage(e) });
    } finally {
      this.saving.set(false);
    }
  }

  protected async saveGoal(g: Partial<Goal>) {
    try {
      const saved = await this.store.saveGoal({ ...g, labelContains: g.labelContains || null });
      this.goals.update((list) => list.map((x) => (x === g ? { ...saved, labelContains: saved.labelContains ?? '' } : x)));
      this.toast.set({ kind: 'success', text: `Goal “${saved.name}” saved.` });
    } catch (e) {
      this.toast.set({ kind: 'error', text: errorMessage(e) });
    }
  }

  protected async removeGoal(g: Partial<Goal>) {
    if (!g.id) return;
    try {
      await this.store.removeGoal(g.id);
      this.goals.update((list) => list.filter((x) => x !== g));
      this.toast.set({ kind: 'success', text: `Goal “${g.name}” deleted.` });
    } catch (e) {
      this.toast.set({ kind: 'error', text: errorMessage(e) });
    }
  }

  protected async updateGeo() {
    try {
      this.geo.set(await this.store.updateGeo());
      setTimeout(() => void this.refreshGeo(), 15_000);
    } catch (e) {
      this.toast.set({ kind: 'error', text: errorMessage(e) });
    }
  }

  private async refreshGeo() {
    const r = await this.store.settings().catch(() => null);
    if (!r) return;
    this.geo.set(r.geo);
    if (r.geo.downloading) setTimeout(() => void this.refreshGeo(), 15_000);
  }
}
