import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { STATUS_LABELS } from '../../core/admissions';
import { AuthStore } from '../../core/auth';
import { AdminApi, type ApplicantRow } from '../api';

/**
 * Admissions → Applicants: the accounts people create to apply, kept apart from staff users.
 * Admissions staff can find an applicant, open their application, reset a password or disable an account.
 */
@Component({
  selector: 'app-applicants-list',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="head">
      <h1>Applicants</h1>
      <p class="a-muted">Accounts created by people applying online. They can only use the applicant portal; staff accounts are in Staff users.</p>
    </div>

    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    @if (secret(); as s) {
      <div class="a-alert a-alert--warning" role="status">
        Temporary password for <strong>{{ s.email }}</strong>: <code class="pw">{{ s.password }}</code><br />
        Give it to the applicant privately (call or SMS them; never by group chat). It is shown only once.
        <div><button class="a-btn a-btn--sm" type="button" (click)="secret.set(null)">Done</button></div>
      </div>
    }

    <form class="a-toolbar filters" (ngSubmit)="find()">
      <input class="a-input" type="search" name="q" placeholder="Search by name or email" aria-label="Search applicants" [(ngModel)]="search" />
      <button class="a-btn" type="submit">Search</button>
      <span class="a-muted a-small">{{ total() }} applicant{{ total() === 1 ? '' : 's' }}</span>
    </form>

    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Applicant</th><th>Application</th><th>Registered</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          @for (a of rows(); track a.id) {
            <tr [class.off]="a.status !== 'active'">
              <td>
                <strong>{{ a.fullName }}</strong>
                <div class="a-small a-muted">{{ a.email }}@if (a.phone) { · {{ a.phone }} }</div>
                @if (a.status !== 'active') {<span class="a-badge">Disabled</span>}
                @if (a.lockedUntil && isFuture(a.lockedUntil)) {<span class="a-badge a-badge--review">Locked</span>}
              </td>
              <td>
                @if (a.application; as app) {
                  @if (canViewApplications() && app.applicationNumber) {
                    <a [routerLink]="['/admin/applications', app.id]">{{ app.applicationNumber }}</a>
                  } @else {
                    <span>{{ app.applicationNumber ?? 'Draft' }}</span>
                  }
                  <span class="a-badge" [class.a-badge--live]="app.status === 'offered' || app.status === 'accepted'">{{ statusLabel(app.status) }}</span>
                  @if (app.programme) {<div class="a-small a-muted">{{ app.programme }}</div>}
                } @else {
                  <span class="a-muted a-small">Not started</span>
                }
              </td>
              <td class="a-small">{{ a.createdAt | date: 'd MMM y' }}</td>
              <td class="a-small">{{ a.lastLoginAt ? (a.lastLoginAt | date: 'd MMM y, HH:mm') : 'Never' }}</td>
              <td class="actions">
                <button class="a-btn a-btn--sm" type="button" (click)="resetPassword(a)">Reset password</button>
                @if (a.status === 'active') {
                  <button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="setStatus(a, 'disabled')">Disable</button>
                } @else {
                  <button class="a-btn a-btn--sm" type="button" (click)="setStatus(a, 'active')">Enable</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="a-empty">{{ loading() ? 'Loading…' : 'No applicants found.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (pages() > 1) {
      <div class="a-toolbar pager">
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span class="a-small">Page {{ page() }} of {{ pages() }}</span>
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next</button>
      </div>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; } .head h1 { margin: 0 0 0.25rem; } .head p { margin: 0; }
    .filters { margin-bottom: 1rem; } .filters .a-input { flex: 1 1 18rem; max-width: 28rem; }
    td .a-badge { margin: 0 0.3rem 0.2rem 0.3rem; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .a-btn + .a-btn { margin-left: 0.35rem; }
    .off td { opacity: 0.65; }
    .pager { justify-content: center; margin-top: 1rem; }
    .pw { font-size: 1.05rem; background: #fff; padding: 0.1rem 0.4rem; border-radius: 4px; }
  `,
})
export class ApplicantsList {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);

  protected readonly rows = signal<ApplicantRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly secret = signal<{ email: string; password: string } | null>(null);
  protected search = '';

  constructor() {
    inject(Title).setTitle('Applicants | Admin');
    void this.load();
  }

  protected canViewApplications() {
    return this.auth.can('applications.view');
  }

  protected statusLabel(s: string) {
    return STATUS_LABELS[s] ?? s;
  }

  protected isFuture(iso: string) {
    return new Date(iso).getTime() > Date.now();
  }

  protected find() {
    this.page.set(1);
    void this.load();
  }

  protected go(page: number) {
    this.page.set(page);
    void this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const res = await this.api.applicants({ search: this.search.trim(), page: this.page() });
      this.rows.set(res.items);
      this.total.set(res.total);
      this.pages.set(Math.max(1, Math.ceil(res.total / res.pageSize)));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.loading.set(false);
    }
  }

  protected async resetPassword(a: ApplicantRow) {
    if (!confirm(`Reset ${a.fullName}'s password? They will be signed out and need the new temporary password.`)) return;
    try {
      const { temporaryPassword } = await this.api.resetApplicantPassword(a.id);
      this.secret.set({ email: a.email, password: temporaryPassword });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected async setStatus(a: ApplicantRow, status: 'active' | 'disabled') {
    if (status === 'disabled' && !confirm(`Disable ${a.fullName}'s account? They will be signed out and cannot sign in until you enable it again. Their application is kept.`)) return;
    try {
      await this.api.setApplicantStatus(a.id, status);
      this.message.set({ kind: 'success', text: `${a.fullName}'s account is ${status === 'active' ? 'enabled' : 'disabled'}.` });
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}
