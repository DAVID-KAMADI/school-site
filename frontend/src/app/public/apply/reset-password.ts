import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { ApplicantApi } from '../../core/admissions';
import { AuthStore } from '../../core/auth';
import { SiteStore } from '../../core/site';

/**
 * /apply/reset-password#<token>: the page the "forgot your password" email links to.
 * The token is read from after the # (never sent to the web server) and then removed from the address bar.
 * The page never asks which account: the server knows it from the token, so the link can only change
 * the password of the account it was emailed to.
 */
@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="apply-hero">
      <div class="container">
        <p class="hero__eyebrow">{{ site.t('apply.eyebrow', 'Admissions') }}</p>
        <h1>Choose a new password</h1>
      </div>
    </section>

    <section class="section">
      <div class="container reset">
        <div class="auth-card">
          @switch (state()) {
            @case ('checking') {
              <p class="muted" role="status">Checking your link…</p>
            }
            @case ('invalid') {
              <h2 class="forgot-title">This link cannot be used</h2>
              <p class="form-error" role="alert">{{ error() }}</p>
              <a class="btn btn--accent" routerLink="/apply">Ask for a new link</a>
            }
            @case ('ready') {
              <form class="form-stack" (ngSubmit)="save()">
                <p class="reset__for">
                  New password for <strong>{{ account() }}</strong>
                </p>
                @if (error()) {
                  <p class="form-error" role="alert">{{ error() }}</p>
                }
                <!-- Lets password managers save the new password against the right account. -->
                <input class="visually-hidden" type="text" name="username" autocomplete="username" [value]="account()" tabindex="-1" aria-hidden="true" readonly />
                <label class="field">
                  <span>New password</span>
                  <input name="password" [type]="show() ? 'text' : 'password'" autocomplete="new-password" required minlength="12" maxlength="200" [(ngModel)]="password" />
                  <small class="muted">At least 12 characters. A short sentence works well.</small>
                </label>
                <label class="field">
                  <span>Type it again</span>
                  <input name="confirm" [type]="show() ? 'text' : 'password'" autocomplete="new-password" required [(ngModel)]="confirm" />
                </label>
                <label class="consent">
                  <input type="checkbox" name="show" [checked]="show()" (change)="show.set(!show())" />
                  <span>Show passwords</span>
                </label>
                <button class="btn btn--accent btn--lg" type="submit" [disabled]="busy()">
                  {{ busy() ? 'Please wait…' : 'Save new password' }}
                </button>
                <p class="muted reset__note">You will be signed out everywhere and can then sign in with the new password.</p>
              </form>
            }
          }
        </div>
      </div>
    </section>
  `,
  styleUrl: './apply.scss',
  styles: `
    .reset {
      max-width: 34rem;
    }
    .reset__for {
      margin: 0;
    }
    .reset__note {
      margin: 0;
      font-size: 0.9rem;
    }
  `,
})
export class ResetPasswordPage {
  protected readonly site = inject(SiteStore);
  private readonly api = inject(ApplicantApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly state = signal<'checking' | 'invalid' | 'ready'>('checking');
  protected readonly account = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly show = signal(false);
  protected password = '';
  protected confirm = '';
  private token = '';

  constructor() {
    inject(Title).setTitle(`Reset your password | ${this.site.institutionName()}`);
    // Keep this page out of search results.
    inject(Meta).updateTag({ name: 'robots', content: 'noindex' });
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.token = decodeURIComponent(location.hash.replace(/^#/, ''));
    // Take the token out of the address bar and history, so it is not left on a shared computer.
    history.replaceState(history.state, '', location.pathname);
    void this.check();
  }

  private async check() {
    if (!this.token) return this.invalid('This page needs the link from the password reset email. Ask for a new link.');
    try {
      await this.auth.ensureCsrf();
      const r = await this.api.checkResetLink(this.token);
      if (!r.valid) return this.invalid();
      this.account.set(r.email ?? '');
      this.state.set('ready');
    } catch (err) {
      this.invalid(errorMessage(err));
    }
  }

  private invalid(
    message = 'This reset link is not valid any more. It may have expired, been used already, or a newer link was sent.',
  ) {
    this.error.set(message);
    this.state.set('invalid');
  }

  async save() {
    this.error.set('');
    if (this.password.length < 12) return this.error.set('Use at least 12 characters for your password.');
    if (this.password !== this.confirm) return this.error.set('The two passwords are different. Type the same password twice.');
    this.busy.set(true);
    try {
      await this.auth.ensureCsrf();
      await this.api.resetPassword(this.token, this.password);
      this.password = this.confirm = this.token = '';
      // Any session in this browser was ended by the reset.
      await this.auth.refresh().catch(() => null);
      await this.router.navigateByUrl('/apply?reset=done');
    } catch (err) {
      const text = errorMessage(err);
      // A link that has stopped working cannot be retried; a weak password can.
      if (/not valid any more/.test(text)) this.invalid(text);
      else this.error.set(text);
    } finally {
      this.busy.set(false);
    }
  }
}
