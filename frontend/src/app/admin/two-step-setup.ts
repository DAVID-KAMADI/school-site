import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import QRCode from 'qrcode';
import { errorMessage } from '../core/api-url.interceptor';
import { AuthStore } from '../core/auth';

/** First-time two-step login setup for staff accounts. */
@Component({
  selector: 'app-two-step-setup',
  imports: [FormsModule],
  template: `
    <main class="setup">
      <div class="a-panel">
        <h1>Set up two-step login</h1>
        <p>Staff accounts need a second step to protect student and applicant data.</p>
        <ol class="a-stack steps">
          <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).</li>
          <li>
            Scan this code with the app.
            @if (qr()) {
              <img class="qr" [src]="qr()" alt="QR code for your authenticator app" width="220" height="220" />
            }
            <details>
              <summary>Can't scan? Enter this key instead</summary>
              <code class="secret">{{ secret() }}</code>
            </details>
          </li>
          <li>
            Enter the 6-digit code the app shows.
            <form class="a-row code-row" (ngSubmit)="enable()">
              <input class="a-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required [(ngModel)]="code" aria-label="6-digit code" />
              <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">Turn on two-step login</button>
            </form>
          </li>
        </ol>
        @if (error()) {
          <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
        }
      </div>
    </main>
  `,
  styles: `
    .setup { max-width: 36rem; margin: 0 auto; padding: 3rem 1rem; }
    .steps { padding-left: 1.2rem; }
    .qr { display: block; margin: 0.75rem 0; border: 1px solid var(--a-line); border-radius: 8px; }
    .secret { display: inline-block; margin-top: 0.4rem; padding: 0.4rem 0.6rem; background: #f1f3f5; border-radius: 6px; word-break: break-all; letter-spacing: 0.08em; }
    .code-row { margin-top: 0.5rem; }
  `,
})
export class TwoStepSetup {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected code = '';
  protected readonly qr = signal('');
  protected readonly secret = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.start();
  }

  private async start() {
    try {
      const me = this.auth.me() ?? (await this.auth.refresh());
      if (!me) return void this.router.navigateByUrl('/admin/login');
      if (me.user.twoFactorEnabled) return void this.router.navigateByUrl('/admin');
      const { secret, otpauthUri } = await this.auth.beginSetup();
      this.secret.set(secret.replace(/(.{4})/g, '$1 ').trim());
      this.qr.set(await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 }));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async enable() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.enable(this.code.trim());
      await this.router.navigateByUrl('/admin');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
