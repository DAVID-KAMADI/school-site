import { DatePipe, JsonPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-url.interceptor';

interface AuditRow {
  id: number;
  action: string;
  user: { id: number; fullName: string; email: string } | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

const GROUPS: { key: string; label: string }[] = [
  { key: '', label: 'Everything' },
  { key: 'security', label: 'Failed & blocked sign-ins' },
  { key: 'auth', label: 'Sign-ins' },
  { key: 'content', label: 'Pages & content' },
  { key: 'media', label: 'Media' },
  { key: 'users', label: 'Users' },
  { key: 'admissions', label: 'Admissions' },
];

/** Plain-language names for recorded actions; unknown ones fall back to the raw key. */
export const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.login_blocked': 'Sign-in blocked (account locked)',
  'auth.account_locked': 'Account locked after failed attempts',
  'auth.2fa_verified': 'Entered two-step code',
  'auth.2fa_failed': 'Wrong two-step code',
  'auth.2fa_enabled': 'Turned on two-step login',
  'auth.password_changed': 'Changed own password',
  'page.create': 'Created page',
  'page.save': 'Saved page draft',
  'page.submit': 'Sent page for review',
  'page.publish': 'Published page',
  'page.unpublish': 'Unpublished page',
  'page.settings': 'Changed page settings',
  'page.trash': 'Moved page to trash',
  'page.restore': 'Restored page',
  'menu.save': 'Changed a menu',
  'text.update': 'Changed interface text',
  'settings.update': 'Changed site settings',
  'redirect.save': 'Saved a redirect',
  'redirect.delete': 'Deleted a redirect',
  'media.upload': 'Uploaded media',
  'media.update': 'Edited media details',
  'media.replace': 'Replaced media file',
  'media.delete': 'Deleted media',
  'user.create': 'Created user',
  'user.update': 'Edited user',
  'user.roles_set': 'Changed user roles',
  'role.permissions_set': 'Changed what a role may do',
  'programme.delete': 'Deleted a programme',
  'short_course.delete': 'Deleted a short course',
  'intake.delete': 'Deleted an intake',
  'document_type.delete': 'Deleted a required document',
  'auth.session_replaced': 'Signed in on a new device (other devices signed out)',
  'role.create': 'Created a role',
  'role.update': 'Renamed a role',
  'role.delete': 'Deleted a role',
  'applicant.status': 'Enabled or disabled an applicant account',
  'applicant.password_reset': "Reset an applicant's password",
  'user.password_reset': 'Reset user password',
  'application.status': 'Changed application status',
  'application.fee': 'Updated application fee',
  'application.withdraw': 'Applicant withdrew application',
};

const PAGE_SIZE = 50;

/** Read-only history of sign-ins, failed attempts and every change made in the admin. */
@Component({
  selector: 'app-audit-log',
  imports: [FormsModule, DatePipe, JsonPipe],
  template: `
    <div class="head"><h1>Audit log</h1></div>
    <p class="a-muted">Who did what and when. Entries cannot be edited or deleted from here.</p>
    @if (error()) {
      <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
    }

    <div class="pipeline" role="group" aria-label="Show">
      @for (g of groups; track g.key) {
        <button type="button" class="chip" [class.chip--on]="group === g.key" [attr.aria-pressed]="group === g.key" (click)="setGroup(g.key)">{{ g.label }}</button>
      }
    </div>

    <form class="a-toolbar filters" (ngSubmit)="load(1)">
      <input class="a-input" type="search" name="search" placeholder="Person's name or email, item id, or IP address" [(ngModel)]="search" aria-label="Search" />
      <select class="a-select" name="action" [(ngModel)]="action" (ngModelChange)="load(1)" aria-label="Action">
        <option value="">Any action</option>
        @for (a of actions(); track a) {<option [value]="a">{{ label(a) }}</option>}
      </select>
      <label class="a-small date">From <input class="a-input" type="date" name="from" [(ngModel)]="from" (ngModelChange)="load(1)" /></label>
      <label class="a-small date">To <input class="a-input" type="date" name="to" [(ngModel)]="to" (ngModelChange)="load(1)" /></label>
      <button class="a-btn" type="submit">Search</button>
    </form>

    <div class="a-table-wrap">
      <table class="a-table">
        <thead>
          <tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>IP address</th></tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr [class.warn]="isWarning(r.action)">
              <td class="a-small nowrap">{{ r.createdAt | date: 'd MMM y, HH:mm:ss' }}</td>
              <td>
                @if (r.user) {
                  {{ r.user.fullName }}<div class="a-small a-muted">{{ r.user.email }}</div>
                } @else {
                  <span class="a-muted">Unknown / system</span>
                }
              </td>
              <td>
                {{ label(r.action) }}
                @if (r.details) {
                  <details><summary class="a-small">Details</summary><pre>{{ r.details | json }}</pre></details>
                }
              </td>
              <td class="a-small">{{ r.entityType ? r.entityType + ' #' + r.entityId : '—' }}</td>
              <td class="a-small">{{ r.ipAddress ?? '—' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="a-empty">{{ loading() ? 'Loading…' : 'Nothing recorded matches.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pages() > 1) {
      <div class="a-toolbar pager">
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() <= 1" (click)="load(page() - 1)">Previous</button>
        <span class="a-muted">Page {{ page() }} of {{ pages() }} · {{ total() }} entries</span>
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() >= pages()" (click)="load(page() + 1)">Next</button>
      </div>
    }
  `,
  styleUrl: '../applications/applications.scss',
  styles: `
    .date { display: inline-flex; align-items: center; gap: 0.4rem; }
    .date .a-input { width: auto; }
    .nowrap { white-space: nowrap; }
    tr.warn td:first-child { box-shadow: inset 3px 0 0 #c0392b; }
    pre { margin: 0.4rem 0 0; padding: 0.5rem; max-width: 28rem; overflow: auto; background: #f6f7f9; border-radius: 6px; font-size: 0.75rem; }
  `,
})
export class AuditLog {
  private readonly http = inject(HttpClient);
  protected readonly groups = GROUPS;

  protected readonly rows = signal<AuditRow[]>([]);
  protected readonly actions = signal<string[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  protected group = '';
  protected action = '';
  protected search = '';
  protected from = '';
  protected to = '';

  constructor() {
    inject(Title).setTitle('Audit log | Admin');
    void this.load(1);
    void firstValueFrom(this.http.get<string[]>('/api/v1/admin/audit/actions'))
      .then((a) => this.actions.set(a))
      .catch(() => undefined);
  }

  protected label(action: string): string {
    return AUDIT_LABELS[action] ?? action;
  }

  protected isWarning(action: string): boolean {
    return ['auth.login_failed', 'auth.login_blocked', 'auth.account_locked', 'auth.2fa_failed'].includes(action);
  }

  setGroup(key: string) {
    this.group = key;
    void this.load(1);
  }

  async load(page: number) {
    this.loading.set(true);
    this.error.set('');
    const q = { group: this.group, action: this.action, search: this.search.trim(), from: this.from, to: this.to, page, pageSize: PAGE_SIZE };
    const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')) as Record<string, string | number>;
    try {
      const res = await firstValueFrom(this.http.get<{ items: AuditRow[]; total: number; page: number }>('/api/v1/admin/audit', { params }));
      this.rows.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
