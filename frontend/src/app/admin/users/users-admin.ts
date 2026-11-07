import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import { AdminApi, type PageSummary, type UserRow } from '../api';

type RoleInfo = { key: string; name: string; description: string | null; permissions: string[] };

/** Staff accounts and what each person may do. */
@Component({
  selector: 'app-users-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Staff users</h1>
        <p class="a-muted a-small intro">
          People who work in this admin portal. What each role may do is set in
          @if (auth.can('access.manage') || auth.can('users.manage')) {<a routerLink="/admin/access-control">Access control</a>} @else {Access control}.
          Applicants are not listed here@if (auth.can('applicants.manage')) {; find them in <a routerLink="/admin/applicants">Admissions → Applicants</a>}.
        </p>
      </div>
      <button class="a-btn a-btn--primary" type="button" (click)="creating.set(true)">+ New staff user</button>
    </div>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    @if (secret(); as s) {
      <div class="a-alert a-alert--warning" role="status">
        Temporary password for <strong>{{ s.email }}</strong>: <code class="pw">{{ s.password }}</code><br />
        Share it privately (not by group chat). It is shown only once. They will set up two-step login when they first sign in.
        <div><button class="a-btn a-btn--sm" type="button" (click)="secret.set(null)">Done</button></div>
      </div>
    }

    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Name</th><th>Roles</th><th>Two-step</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr [class.disabled]="u.status !== 'active'">
              <td><strong>{{ u.fullName }}</strong><div class="a-small a-muted">{{ u.email }}</div>
                @if (u.status !== 'active') {<span class="a-badge">{{ u.status }}</span>}
                @if (u.lockedUntil && isFuture(u.lockedUntil)) {<span class="a-badge a-badge--review">Locked</span>}
              </td>
              <td>
                @for (r of u.roles; track $index) {
                  <span class="a-badge">{{ r.roleName }}@if (r.scopePageId) { · {{ pageTitle(r.scopePageId) }} }</span>
                } @empty {
                  <span class="a-muted a-small">No roles</span>
                }
              </td>
              <td>{{ u.twoFactorEnabled ? 'On' : 'Not set up' }}</td>
              <td class="a-small">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM y, HH:mm') : 'Never' }}</td>
              <td class="actions"><button class="a-btn a-btn--sm" type="button" (click)="edit(u)">Manage</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (creating()) {
      <div class="a-modal-backdrop" (click)="creating.set(false)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-label="New user" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <h2>New staff user</h2>
          <label class="a-field"><span>Full name</span><input class="a-input" name="name" required [(ngModel)]="newName" /></label>
          <label class="a-field"><span>Email</span><input class="a-input" name="email" type="email" required [(ngModel)]="newEmail" /></label>
          <label class="a-field"><span>Phone (optional)</span><input class="a-input" name="phone" [(ngModel)]="newPhone" /></label>
          <p class="a-help">A temporary password is generated. Assign roles on the next screen.</p>
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit">Create staff user</button>
            <button class="a-btn" type="button" (click)="creating.set(false)">Cancel</button>
          </div>
        </form>
      </div>
    }

    @if (editing(); as u) {
      <div class="a-modal-backdrop" (click)="editing.set(null)">
        <div class="a-modal a-stack" role="dialog" aria-modal="true" [attr.aria-label]="'Manage ' + u.fullName" (click)="$event.stopPropagation()">
          <h2>{{ u.fullName }}</h2>
          <h3>Roles</h3>
          <ul class="grants">
            @for (g of grants(); track $index; let i = $index) {
              <li class="a-row">
                <select class="a-select" [(ngModel)]="g.roleKey" aria-label="Role">
                  @for (r of roles(); track r.key) {
                    <option [value]="r.key">{{ r.name }}</option>
                  }
                </select>
                <select class="a-select" [(ngModel)]="g.scopePageId" aria-label="Section">
                  <option [ngValue]="null">Whole site</option>
                  @for (p of pages(); track p.id) {
                    <option [ngValue]="p.id">Only {{ p.title }} ({{ p.path }})</option>
                  }
                </select>
                <button class="a-btn a-btn--sm a-btn--danger rm" type="button" (click)="removeGrant(i)">Remove</button>
              </li>
            }
          </ul>
          <div><button class="a-btn a-btn--sm" type="button" (click)="addGrant()">+ Add role</button></div>
          <details class="a-small">
            <summary>What each role can do</summary>
            <ul>
              @for (r of roles(); track r.key) {
                <li><strong>{{ r.name }}</strong>: {{ r.description }}</li>
              }
            </ul>
            <a routerLink="/admin/access-control">See or change each role's permissions in Access control</a>
          </details>
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="button" (click)="saveRoles(u)">Save roles</button>
          </div>

          <h3>Account</h3>
          <div class="a-toolbar">
            <button class="a-btn a-btn--sm" type="button" (click)="resetPassword(u)">Reset password</button>
            @if (u.twoFactorEnabled) {
              <button class="a-btn a-btn--sm" type="button" (click)="resetTwoFactor(u)">Reset two-step login (lost phone)</button>
            }
            @if (u.id !== auth.user()?.id) {
              @if (u.status === 'active') {
                <button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="setStatus(u, 'disabled')">Disable account</button>
              } @else {
                <button class="a-btn a-btn--sm" type="button" (click)="setStatus(u, 'active')">Enable account</button>
              }
            }
          </div>
          <div><button class="a-btn" type="button" (click)="editing.set(null)">Close</button></div>
        </div>
      </div>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; } .head h1 { margin: 0; } .intro { margin: 0.25rem 0 0; max-width: 60ch; }
    td .a-badge { margin: 0 0.25rem 0.25rem 0; }
    .disabled td { opacity: 0.6; }
    .actions { text-align: right; }
    .grants { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
    .rm { flex: 0 0 auto !important; }
    .pw { font-size: 1.05rem; background: #fff; padding: 0.1rem 0.4rem; border-radius: 4px; }
  `,
})
export class UsersAdmin {
  private readonly api = inject(AdminApi);
  protected readonly auth = inject(AuthStore);
  protected readonly users = signal<UserRow[]>([]);
  protected readonly roles = signal<RoleInfo[]>([]);
  protected readonly pages = signal<PageSummary[]>([]);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly secret = signal<{ email: string; password: string } | null>(null);
  protected readonly creating = signal(false);
  protected readonly editing = signal<UserRow | null>(null);
  protected readonly grants = signal<{ roleKey: string; scopePageId: number | null }[]>([]);
  protected newName = '';
  protected newEmail = '';
  protected newPhone = '';

  constructor() {
    inject(Title).setTitle('Staff users | Admin');
    void this.load();
  }

  private async load() {
    try {
      const [users, roles, pages] = await Promise.all([this.api.users(), this.api.roles(), this.api.pages()]);
      this.users.set(users);
      this.roles.set(roles);
      this.pages.set(pages.sort((a, b) => a.path.localeCompare(b.path)));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected pageTitle(id: number) {
    return this.pages().find((p) => p.id === id)?.title ?? `page ${id}`;
  }

  protected isFuture(iso: string) {
    return new Date(iso).getTime() > Date.now();
  }

  async create() {
    try {
      const res = await this.api.createUser({ fullName: this.newName.trim(), email: this.newEmail.trim(), phone: this.newPhone.trim() || undefined });
      this.secret.set({ email: this.newEmail.trim(), password: res.temporaryPassword ?? '' });
      this.creating.set(false);
      this.newName = this.newEmail = this.newPhone = '';
      await this.load();
      const created = this.users().find((u) => u.id === res.id);
      if (created) this.edit(created);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  edit(u: UserRow) {
    this.grants.set(u.roles.map((r) => ({ roleKey: r.roleKey, scopePageId: r.scopePageId })));
    this.editing.set(u);
  }

  addGrant() {
    this.grants.update((g) => [...g, { roleKey: this.roles().find((r) => r.key !== 'super_admin')?.key ?? '', scopePageId: null }]);
  }

  removeGrant(i: number) {
    this.grants.update((g) => g.filter((_, j) => j !== i));
  }

  async saveRoles(u: UserRow) {
    try {
      await this.api.setRoles(u.id, this.grants());
      this.message.set({ kind: 'success', text: `Roles saved for ${u.fullName}. They will need to sign in again.` });
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async resetPassword(u: UserRow) {
    if (!confirm(`Reset ${u.fullName}'s password? They will be signed out everywhere.`)) return;
    try {
      const { temporaryPassword } = await this.api.resetPassword(u.id);
      this.secret.set({ email: u.email, password: temporaryPassword });
      this.editing.set(null);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async resetTwoFactor(u: UserRow) {
    if (!confirm(`Reset two-step login for ${u.fullName}? They will set it up again at next sign-in.`)) return;
    await this.api.resetTwoFactor(u.id).catch((err) => this.message.set({ kind: 'error', text: errorMessage(err) }));
    this.editing.set(null);
    await this.load();
  }

  async setStatus(u: UserRow, status: 'active' | 'disabled') {
    try {
      await this.api.updateUser(u.id, { status });
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}
