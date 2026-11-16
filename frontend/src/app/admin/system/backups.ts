import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import { AdminApi, type BackupRow, type BackupStatus } from '../api';
import { toastChannel } from '../toast';

const REASON_LABEL: Record<BackupRow['reason'], string> = {
  manual: 'Manual',
  scheduled: 'Nightly',
  'before-restore': 'Before a restore',
  'command-line': 'Command line',
};

/**
 * Backups & restore (super administrators): make a backup, roll the whole site back to one after a
 * data breach, damaged data or a bad change, and sign everyone out in an emergency.
 */
@Component({
  selector: 'app-backups',
  imports: [FormsModule, DatePipe, DecimalPipe],
  template: `
    <h1>Backups &amp; restore</h1>
    <p class="a-muted intro">
      A backup holds the whole database and every uploaded file (media and applicant documents). Restoring one rolls the
      entire site back to that moment: everything added or changed since is undone. Use it after a data breach, damaged
      data or a change that went badly wrong.
    </p>

    @if (restoreProgress(); as p) {
      <section class="a-panel progress" role="status" aria-live="polite">
        @if (p === 'running') {
          <h2><span class="spinner" aria-hidden="true"></span> Restoring the site…</h2>
          <p>Don't close this page. The site shows “under maintenance” until this finishes, usually in a few minutes.</p>
        } @else if (p === 'done') {
          <h2>Restore finished</h2>
          <p>
            The site has been rolled back and <strong>everyone has been signed out</strong>, including you. The state from just
            before the restore was saved as a backup, so nothing is lost.
          </p>
          <a class="a-btn a-btn--primary" href="/admin">Sign in again</a>
        } @else {
          <h2>The restore did not complete</h2>
          <p>
            The site was put back as it was before. Everyone has been signed out. Sign in again to see the reason on this page,
            or ask your technical team to check the API log.
          </p>
          <a class="a-btn a-btn--primary" href="/admin">Sign in again</a>
        }
      </section>
    } @else {
      @if (status()?.job; as job) {
        <section class="a-panel progress" role="status" aria-live="polite">
          <h2><span class="spinner" aria-hidden="true"></span> {{ job.kind === 'backup' ? 'Making a backup…' : 'Restoring…' }}</h2>
          <p class="a-small">{{ job.step }} Started {{ job.startedAt | date: 'shortTime' }} by {{ job.by }}.</p>
        </section>
      } @else if (status()?.last; as last) {
        <div class="a-alert" [class]="last.ok ? 'a-alert--success' : 'a-alert--error'" role="status">
          {{ last.message }}
          <span class="a-small">({{ last.finishedAt | date: 'medium' }})</span>
        </div>
      }

      <section class="a-panel a-row create">
        <label class="a-field note">
          <span>Make a backup now</span>
          <input class="a-input" name="note" maxlength="200" [(ngModel)]="note" placeholder="Optional note, e.g. Before uploading term results" />
        </label>
        <button type="button" class="a-btn a-btn--primary" [disabled]="busy() || !!status()?.job" (click)="create()">Back up now</button>
        <p class="a-help full">
          @if (status()?.schedule?.automatic) {
            A backup is also made automatically every night at {{ hour(status()!.schedule.hour) }}.
          } @else {
            <strong>Automatic nightly backups are switched off</strong> (BACKUP_AUTO=false on the server).
          }
          The newest 14 are kept, plus one a week for 8 weeks, so a backup from before a breach found later is still there.
          @if (!status()?.offsiteCopy) {
            <br /><strong>Backups are only on this server.</strong> Ask your technical team to set BACKUP_COPY_DIR (another
            disk or a synced cloud folder), or a disk failure would lose the site and its backups together.
          }
        </p>
      </section>

      <div class="a-table-wrap list">
        <table class="a-table">
          <thead>
            <tr><th>Made</th><th>Type</th><th>Note</th><th>Contents</th><th>Size</th><th></th></tr>
          </thead>
          <tbody>
            @for (b of backups(); track b.name) {
              <tr>
                <td>
                  <strong>{{ b.createdAt | date: 'EEE d MMM y, HH:mm' }}</strong>
                  <div class="a-small a-muted"><code>{{ b.name }}</code></div>
                </td>
                <td>
                  <span class="a-badge" [class.a-badge--review]="b.reason === 'before-restore'">{{ reason(b.reason) }}</span>
                  @if (b.createdBy) { <div class="a-small a-muted">{{ b.createdBy }}</div> }
                </td>
                <td class="a-small">{{ b.note ?? '' }}</td>
                <td class="a-small">{{ b.rows | number }} records in {{ b.tables }} tables<br />{{ b.files | number }} files</td>
                <td class="a-small">{{ b.sizeBytes / 1048576 | number: '1.1-1' }} MB</td>
                <td><button type="button" class="a-btn a-btn--danger" [disabled]="!!status()?.job" (click)="openRestore(b)">Restore…</button></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="a-empty">No backups yet. Make the first one now.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <section class="a-panel emergency">
        <h2>Emergency: sign everyone out</h2>
        <p class="a-small">
          If you suspect someone has got into an account, sign out every staff member, applicant and student at once (you stay
          signed in). Then reset the affected passwords, and consider switching sign-in links on under
          <a href="/admin/access-management">Staff sign-in links</a>. Restoring a backup also signs everyone out.
        </p>
        @if (signingOut()) {
          <form class="a-row confirm" (ngSubmit)="signOutEveryone()">
            <label class="a-field"><span>Your password</span>
              <input class="a-input" type="password" name="soPassword" autocomplete="current-password" required [(ngModel)]="password" />
            </label>
            @if (twoFactor()) {
              <label class="a-field code"><span>Authenticator code</span>
                <input class="a-input" name="soCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required [(ngModel)]="code" />
              </label>
            }
            <button class="a-btn a-btn--danger" type="submit" [disabled]="busy()">Sign everyone out</button>
            <button class="a-btn" type="button" (click)="signingOut.set(false)">Cancel</button>
          </form>
        } @else {
          <button type="button" class="a-btn a-btn--danger" (click)="signingOut.set(true); clearSecrets()">Sign everyone out…</button>
        }
      </section>
    }

    @if (restoring(); as b) {
      <div class="a-modal-backdrop" (click)="closeRestore()">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-labelledby="restore-title" (click)="$event.stopPropagation()" (ngSubmit)="restore(b)">
          <h2 id="restore-title">Restore the site to {{ b.createdAt | date: 'd MMM y, HH:mm' }}?</h2>
          <ul class="a-small what">
            <li>Everything added or changed since then is undone: pages, applications, users, settings{{ includeFiles ? ', uploaded files' : '' }}.</li>
            <li>The current state is saved as a backup first, so it can be brought back or examined later.</li>
            <li>The site shows “under maintenance” for a few minutes.</li>
            <li>Everyone is signed out, including you.</li>
          </ul>
          <label class="a-check">
            <input type="checkbox" name="includeFiles" [(ngModel)]="includeFiles" [disabled]="!b.hasFiles" />
            Also restore uploaded files (media and applicant documents)
          </label>
          <label class="a-field"><span>Your password</span>
            <input class="a-input" type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" />
          </label>
          @if (twoFactor()) {
            <label class="a-field"><span>Authenticator code</span>
              <input class="a-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required [(ngModel)]="code" />
            </label>
          }
          <label class="a-field"><span>Type RESTORE to confirm</span>
            <input class="a-input" name="confirm" autocomplete="off" required [(ngModel)]="confirmText" />
          </label>
          @if (dialogError()) {
            <div class="a-alert a-alert--error" role="alert">{{ dialogError() }}</div>
          }
          <div class="a-row">
            <button class="a-btn a-btn--danger" type="submit" [disabled]="busy() || confirmText !== 'RESTORE' || !password">Restore this backup</button>
            <button class="a-btn" type="button" (click)="closeRestore()">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .intro { max-width: 75ch; }
    .create { margin-top: 1rem; flex-wrap: wrap; align-items: end; }
    .create .note { flex: 1 1 22rem; }
    .create .full { flex: 1 0 100%; margin: 0; }
    .list { margin-top: 1rem; }
    .progress h2 { display: flex; gap: 0.6rem; align-items: center; margin: 0 0 0.4rem; font-size: 1.1rem; }
    .progress { margin-top: 1rem; }
    .emergency { margin-top: 1.5rem; border-left: 4px solid var(--a-danger); }
    .emergency h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
    .confirm { flex-wrap: wrap; align-items: end; }
    .confirm .code { max-width: 10rem; }
    .what { margin: 0; padding-left: 1.2rem; display: grid; gap: 0.3rem; }
    .spinner { width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid var(--a-line); border-top-color: var(--a-primary); animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class Backups {
  private readonly api = inject(AdminApi);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  protected readonly backups = signal<BackupRow[]>([]);
  protected readonly status = signal<BackupStatus | null>(null);
  protected readonly message = toastChannel();
  protected readonly busy = signal(false);
  protected readonly restoring = signal<BackupRow | null>(null);
  protected readonly dialogError = signal('');
  protected readonly signingOut = signal(false);
  /** Set once a restore has started: from then on only the public maintenance status can be read. */
  protected readonly restoreProgress = signal<'running' | 'done' | 'failed' | null>(null);
  protected readonly twoFactor = () => !!this.auth.user()?.twoFactorEnabled;

  protected note = '';
  protected password = '';
  protected code = '';
  protected confirmText = '';
  protected includeFiles = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(Title).setTitle('Backups & restore | Admin');
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
    void this.load();
  }

  protected reason(r: BackupRow['reason']) {
    return REASON_LABEL[r] ?? r;
  }

  protected hour(h: number) {
    return `${String(h).padStart(2, '0')}:00`;
  }

  protected clearSecrets() {
    this.password = '';
    this.code = '';
    this.confirmText = '';
  }

  private async load() {
    try {
      const res = await this.api.backups();
      this.backups.set(res.backups);
      this.status.set(res);
      if (res.job) this.poll();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  /** While a backup runs, checks every two seconds and reloads the list when it is done. */
  private poll() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        const s = await this.api.backupStatus();
        this.status.set(s);
        if (s.job) this.poll();
        else await this.load();
      } catch {
        this.poll();
      }
    }, 2000);
  }

  async create() {
    this.busy.set(true);
    this.message.set(null);
    try {
      this.status.set(await this.api.createBackup(this.note.trim() || undefined));
      this.note = '';
      this.poll();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected openRestore(b: BackupRow) {
    this.clearSecrets();
    this.includeFiles = b.hasFiles;
    this.dialogError.set('');
    this.restoring.set(b);
  }

  protected closeRestore() {
    this.clearSecrets();
    this.restoring.set(null);
  }

  async restore(b: BackupRow) {
    this.busy.set(true);
    this.dialogError.set('');
    try {
      await this.api.restoreBackup(b.name, {
        password: this.password,
        code: this.code.trim() || undefined,
        confirm: this.confirmText,
        includeFiles: this.includeFiles,
      });
      this.closeRestore();
      this.restoreProgress.set('running');
      this.followRestore();
    } catch (err) {
      this.dialogError.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Follows the restore through the public maintenance status (the session is removed at the end). */
  private followRestore() {
    this.timer = setTimeout(async () => {
      try {
        const m = await firstValueFrom(
          this.http.get<{ restoring: boolean; lastRestore: { ok: boolean } | null }>('/api/v1/maintenance'),
        );
        if (m.restoring) return this.followRestore();
        this.auth.me.set(null);
        this.restoreProgress.set(m.lastRestore?.ok ? 'done' : 'failed');
      } catch {
        this.followRestore();
      }
    }, 3000);
  }

  async signOutEveryone() {
    this.busy.set(true);
    this.message.set(null);
    try {
      const res = await this.api.signOutEveryone({ password: this.password, code: this.code.trim() || undefined });
      this.signingOut.set(false);
      this.clearSecrets();
      this.message.set({ kind: 'success', text: `Done: ${res.signedOut} session(s) signed out. You are still signed in.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }
}
