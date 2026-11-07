import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type PortalKey, type PortalKeyEvent, type UserRow } from '../api';

const STATUS_LABEL: Record<PortalKey['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  exhausted: 'All places taken',
};

const EVENT_LABEL: Record<PortalKeyEvent['event'], string> = {
  key_created: 'Link created',
  key_revoked: 'Link revoked',
  key_verified: 'Sign-in link opened',
  key_blocked: 'Blocked (too many wrong links)',
  staff_login: 'Staff signed in',
  staff_login_denied: 'Sign-in refused',
};

const REASON_LABEL: Record<string, string> = {
  invalid: 'wrong link',
  expired: 'link expired',
  revoked: 'link revoked',
  no_access_pass: 'did not come through a sign-in link',
  link_belongs_to_others: 'the link belongs to other staff',
};

/** "YYYY-MM-DDTHH:mm" in local time, for a datetime-local input. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Staff Portal Access Management: the sign-in links (/admin/<token>) that are the only way to reach
 * the staff sign-in page. The API checks the portal_keys.manage permission on every call.
 */
@Component({
  selector: 'app-portal-keys',
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Staff sign-in links</h1>
    <p class="a-muted intro">
      The staff sign-in page is hidden: <code>/admin</code> shows “page not found”. Staff open it through their own sign-in
      link and then sign in as usual with their email, password and authenticator code. A link never signs anyone in on its
      own. Once someone has signed in through a link it is theirs, and nobody else can use it.
    </p>

    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }

    @if (created(); as c) {
      <section class="a-panel created" aria-live="polite">
        <h2>Sign-in link for “{{ c.record.name }}”</h2>
        <p class="a-small"><strong>Copy it now.</strong> This is the only time it is shown: only a secure fingerprint is kept.</p>
        <div class="key-box">
          <code class="key">{{ linkFor(c.key) }}</code>
          <button type="button" class="a-btn a-btn--primary" (click)="copy(linkFor(c.key))">{{ copied() ? 'Copied' : 'Copy link' }}</button>
        </div>
        <p class="a-help">
          Share it only through an official channel (e.g. in person or your institution email), never in a public group, and
          ask them to bookmark it.
          @if (c.record.people.length) {
            Only {{ c.record.people[0].fullName }} can sign in with it,
          } @else {
            The first {{ c.record.maxUses === 1 ? 'person' : c.record.maxUses + ' people' }} to sign in with it will keep it,
          }
          until {{ c.record.expiresAt | date: 'medium' }}.
        </p>
        <button type="button" class="a-btn" (click)="created.set(null)">I have saved it</button>
      </section>
    }

    <form class="a-panel a-row generate" (ngSubmit)="generate()">
      <label class="a-field name">
        <span>Link name</span>
        <input class="a-input" name="name" maxlength="120" required [(ngModel)]="name" placeholder="e.g. Jane Wanjiku, registry" />
      </label>
      @if (staff().length) {
        <label class="a-field person">
          <span>For staff member</span>
          <select class="a-input" name="userId" [(ngModel)]="userId">
            <option [ngValue]="null">Anyone (first to sign in)</option>
            @for (u of staff(); track u.id) {
              <option [ngValue]="u.id">{{ u.fullName }} ({{ u.email }})</option>
            }
          </select>
        </label>
      }
      <label class="a-field">
        <span>Expires</span>
        <input class="a-input" type="datetime-local" name="expires" required [(ngModel)]="expires" [min]="minExpiry" [max]="maxExpiry" />
      </label>
      @if (!userId) {
        <label class="a-field uses">
          <span>Number of staff</span>
          <input class="a-input" type="number" name="uses" min="1" max="500" required [(ngModel)]="maxUses" />
        </label>
      }
      <button class="a-btn a-btn--primary go" type="submit" [disabled]="busy() || !name.trim()">Create sign-in link</button>
      <p class="a-help full">
        Best: one link per person. A link for “anyone” belongs to whoever signs in with it first, up to the number of staff
        you choose. Opening the link uses nothing up.
      </p>
    </form>

    <div class="a-table-wrap list">
      <table class="a-table">
        <thead>
          <tr><th>Link</th><th>Status</th><th>Used by</th><th>Created</th><th>Expires</th><th>Last used</th><th></th></tr>
        </thead>
        <tbody>
          @for (k of keys(); track k.id) {
            <tr [class.selected]="selected()?.id === k.id">
              <td>
                <strong>{{ k.name }}</strong><br />
                <span class="a-small a-muted hint">/admin/…-{{ k.keyHint }}</span>
              </td>
              <td><span class="a-badge" [class]="'a-badge status status--' + k.status">{{ label(k.status) }}</span></td>
              <td>
                @for (p of k.people; track p.id) {
                  {{ p.fullName }}<br />
                } @empty {
                  <span class="a-muted">Nobody yet</span><br />
                }
                @if (k.maxUses > 1) {
                  <span class="a-small a-muted">{{ k.currentUses }} of {{ k.maxUses }} places</span>
                }
              </td>
              <td>
                {{ k.createdAt | date: 'medium' }}<br />
                <span class="a-small a-muted">by {{ k.createdBy?.fullName ?? 'command line' }}</span>
              </td>
              <td>{{ k.expiresAt | date: 'medium' }}</td>
              <td>
                @if (k.revokedAt) {
                  <span class="a-small">Revoked {{ k.revokedAt | date: 'medium' }}@if (k.revokedBy) { by {{ k.revokedBy.fullName }} }</span>
                } @else {
                  {{ k.lastUsedAt ? (k.lastUsedAt | date: 'medium') : 'Never' }}
                }
              </td>
              <td class="actions">
                <button type="button" class="a-btn a-btn--sm" (click)="showActivity(k)">Activity</button>
                @if (k.status !== 'revoked') {
                  @if (confirming() === k.id) {
                    <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="revoke(k)" [disabled]="busy()">Confirm revoke</button>
                    <button type="button" class="a-btn a-btn--sm" (click)="confirming.set(null)">Cancel</button>
                  } @else {
                    <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="confirming.set(k.id)">Revoke</button>
                  }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="a-empty">No sign-in links yet. Create one above.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <section class="a-panel activity">
      <div class="a-toolbar a-toolbar--spread">
        <h2>{{ selected() ? 'Activity for “' + selected()!.name + '”' : 'Recent sign-in link activity (all links)' }}</h2>
        @if (selected()) {
          <button type="button" class="a-btn a-btn--sm" (click)="showActivity(null)">Show all links</button>
        }
      </div>
      <div class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>When</th><th>What</th><th>Result</th><th>Person</th>@if (!selected()) {<th>Link</th>}<th>IP address</th></tr></thead>
          <tbody>
            @for (e of events(); track e.id) {
              <tr>
                <td>{{ e.at | date: 'medium' }}</td>
                <td>{{ eventLabel(e) }}</td>
                <td>
                  <span class="a-badge" [class.a-badge--live]="e.success" [class.status--revoked]="!e.success">{{ e.success ? 'OK' : 'Refused' }}</span>
                  @if (e.reason) { <span class="a-small a-muted"> {{ reasonLabel(e.reason) }}</span> }
                </td>
                <td>{{ e.user?.fullName ?? '—' }}</td>
                @if (!selected()) {
                  <td>{{ e.key ? e.key.name : '—' }}</td>
                }
                <td><code class="a-small">{{ e.ipAddress ?? '—' }}</code></td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="selected() ? 5 : 6" class="a-empty">No activity yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .intro { max-width: 70ch; }
    .generate { margin-top: 1rem; flex-wrap: wrap; align-items: end; }
    .generate .name { flex: 2 1 16rem; }
    .generate .uses { flex: 0 0 9rem; }
    .generate .person { flex: 1 1 14rem; }
    .generate .go { flex: 0 0 auto; }
    .generate .full { flex: 1 0 100%; margin: 0; }
    .list { margin-top: 1rem; }
    .hint { font-family: ui-monospace, Consolas, monospace; }
    .actions { white-space: nowrap; display: flex; gap: 0.35rem; }
    tr.selected td { background: var(--a-primary-soft); }
    .status--active { background: var(--a-success-soft); color: var(--a-success); }
    .status--exhausted { background: var(--a-warning-soft); color: var(--a-warning); }
    .status--revoked { background: #fdecec; color: var(--a-danger); }
    .created { margin-top: 1rem; border: 2px solid var(--a-success); }
    .created h2 { margin-top: 0; }
    .key-box { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin: 0.75rem 0; }
    .key { font-size: clamp(0.85rem, 1.8vw, 1.05rem); word-break: break-all; font-weight: 700; letter-spacing: 0.06em; padding: 0.6rem 0.9rem; border-radius: 8px; background: #f3f5f9; user-select: all; }
    .activity { margin-top: 1.5rem; }
    .activity h2 { margin: 0; font-size: 1.1rem; }
  `,
})
export class PortalKeys {
  private readonly api = inject(AdminApi);
  protected readonly keys = signal<PortalKey[]>([]);
  protected readonly events = signal<PortalKeyEvent[]>([]);
  protected readonly selected = signal<PortalKey | null>(null);
  protected readonly created = signal<{ key: string; record: PortalKey } | null>(null);
  protected readonly confirming = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  /** Active staff, for personal links. Empty (and the choice hidden) without permission to list users. */
  protected readonly staff = signal<UserRow[]>([]);
  protected userId: number | null = null;

  protected name = '';
  protected expires = localInput(new Date(Date.now() + 7 * 86_400_000));
  protected maxUses = 1;
  protected readonly minExpiry = localInput(new Date(Date.now() + 5 * 60_000));
  protected readonly maxExpiry = localInput(new Date(Date.now() + 365 * 86_400_000));

  constructor() {
    inject(Title).setTitle('Staff sign-in links | Admin');
    void this.load();
    this.api
      .users()
      .then((users) => this.staff.set(users.filter((u) => u.status !== 'disabled' && u.roles.length)))
      .catch(() => undefined);
  }

  /** The full sign-in address for a token. */
  protected linkFor(key: string) {
    return `${location.origin}/admin/${key}`;
  }

  protected label(s: PortalKey['status']) {
    return STATUS_LABEL[s];
  }

  protected eventLabel(e: PortalKeyEvent) {
    return EVENT_LABEL[e.event] ?? e.event;
  }

  protected reasonLabel(r: string) {
    return REASON_LABEL[r] ?? r;
  }

  private async load() {
    try {
      const [keys, events] = await Promise.all([this.api.portalKeys(), this.api.portalKeyActivity(this.selected()?.id)]);
      this.keys.set(keys);
      this.events.set(events);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async generate() {
    const expires = new Date(this.expires);
    if (Number.isNaN(expires.getTime())) {
      this.message.set({ kind: 'error', text: 'Choose when the link expires.' });
      return;
    }
    this.busy.set(true);
    this.message.set(null);
    try {
      const res = await this.api.createPortalKey({
        name: this.name.trim(),
        expiresAt: expires.toISOString(),
        maxUses: this.userId ? 1 : Number(this.maxUses),
        ...(this.userId ? { userId: this.userId } : {}),
      });
      this.created.set(res);
      this.copied.set(false);
      this.name = '';
      this.userId = null;
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(k: PortalKey) {
    this.busy.set(true);
    try {
      await this.api.revokePortalKey(k.id);
      this.confirming.set(null);
      this.message.set({ kind: 'success', text: `“${k.name}” was revoked. The link shows “page not found” from now on; anyone who needs it gets a new one.` });
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  async showActivity(k: PortalKey | null) {
    this.selected.set(k);
    try {
      this.events.set(await this.api.portalKeyActivity(k?.id));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      this.copied.set(true);
    } catch {
      this.message.set({ kind: 'warning', text: 'Could not copy automatically. Select the link and copy it by hand.' });
    }
  }
}
