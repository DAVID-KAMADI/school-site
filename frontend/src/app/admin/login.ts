import { Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../core/auth';
import { errorMessage } from '../core/api-url.interceptor';
import { SiteStore } from '../core/site';
import { Icon } from './icon';

/**
 * Staff sign-in: email and password, then the 6-digit code from the authenticator app.
 * Browser suggestions are switched off on purpose: the admin shares a domain with the applicant
 * portal, so a browser would otherwise offer applicants' saved emails here (e.g. on a shared office PC).
 */
@Component({
  selector: 'app-admin-login',
  imports: [FormsModule, Icon],
  template: `
    <main class="login">
      <aside class="brand" aria-hidden="true">
        <div class="brand__inner">
          @if (logo(); as img) {
            <img class="brand__logo" [src]="img.url" alt="" />
          }
          <p class="brand__name">{{ site.institutionName() || 'Staff portal' }}</p>
          <h2 class="brand__title">Staff portal</h2>
          <p class="brand__text">Manage the website, admissions and timetables in one secure place.</p>
          <ul class="brand__points">
            <li><app-icon name="shield" [size]="18" /> Two-step login on every account</li>
            <li><app-icon name="clock" [size]="18" /> Signed out after 15 minutes of inactivity</li>
            <li><app-icon name="activity" [size]="18" /> Every change is recorded in the audit log</li>
          </ul>
        </div>
      </aside>

      <section class="panel">
        <div class="login-card">
          <div class="login-card__top">
            <p class="login-card__eyebrow">{{ site.institutionName() || 'Admin portal' }}</p>
          </div>

          @if (step() === 'password') {
            <h1>Staff sign in</h1>
            <p class="lead">
              Enter your work email and password. Signing in here will sign out any other device
              using your account.
            </p>
          } @else {
            <h1>Enter your code</h1>
            <p class="lead">Open your authenticator app and enter the 6-digit code for this site.</p>
          }

          @if (replaced() && step() === 'password') {
            <div class="a-alert a-alert--warning" role="status">
              You were signed out because your account was used to sign in on another device. If that wasn't you,
              sign in, change your password straight away and tell your administrator.
            </div>
          }
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert" id="login-error">{{ error() }}</div>
          }

          @if (step() === 'password') {
            <form class="form" (ngSubmit)="signIn()" autocomplete="off" novalidate>
              <label class="field">
                <span>Email</span>
                <span class="control">
                  <app-icon name="user" [size]="18" />
                  <input
                    #emailInput
                    type="email"
                    name="staff_login_email"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    inputmode="email"
                    placeholder="name@institution.ac.ke"
                    required
                    [(ngModel)]="email"
                    (ngModelChange)="emailError.set('')"
                    (blur)="checkEmail()"
                    [attr.aria-invalid]="!!emailError()"
                    [attr.aria-describedby]="emailError() ? 'email-error' : null"
                  />
                </span>
                @if (emailError()) {
                  <span class="field__error" id="email-error">{{ emailError() }}</span>
                }
              </label>

              <label class="field">
                <span>Password</span>
                <span class="control">
                  <app-icon name="shield" [size]="18" />
                  <input
                    [type]="showPassword() ? 'text' : 'password'"
                    name="staff_login_secret"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    required
                    [(ngModel)]="password"
                    (keydown)="capsCheck($event)"
                    (keyup)="capsCheck($event)"
                    (blur)="capsLock.set(false)"
                  />
                  <button type="button" class="pw-toggle" (click)="showPassword.set(!showPassword())" [attr.aria-pressed]="showPassword()" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">
                    {{ showPassword() ? 'Hide' : 'Show' }}
                  </button>
                </span>
                @if (capsLock()) {
                  <span class="field__hint" role="status">Caps Lock is on.</span>
                }
              </label>

              <button class="submit" type="submit" [disabled]="busy()">
                @if (busy()) {
                  <span class="spinner" aria-hidden="true"></span> Signing in…
                } @else {
                  Sign in <app-icon name="arrow" [size]="18" />
                }
              </button>
              <p class="help">Forgotten your password? Ask an administrator to reset it under Staff users.</p>
            </form>
          } @else {
            <form class="form" (ngSubmit)="verify()" autocomplete="off">
              <label class="field">
                <span>6-digit code</span>
                <input
                  #codeInput
                  class="code"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  pattern="[0-9]{6}"
                  placeholder="••••••"
                  required
                  [(ngModel)]="code"
                  (ngModelChange)="onCode($event)"
                />
              </label>
              <button class="submit" type="submit" [disabled]="busy() || code.length !== 6">
                @if (busy()) {
                  <span class="spinner" aria-hidden="true"></span> Checking…
                } @else {
                  Continue <app-icon name="arrow" [size]="18" />
                }
              </button>
              <button class="link" type="button" (click)="startOver()">Use a different account</button>
            </form>
          }

          <a class="back" href="/"><app-icon name="external" [size]="16" /> Back to the website</a>
        </div>
      </section>
    </main>
  `,
  styleUrl: './staff-auth.scss',
})
export class AdminLogin {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly site = inject(SiteStore);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected email = '';
  protected password = '';
  protected code = '';
  /** Someone who has entered their password but not yet their code continues at the code step. */
  protected readonly step = signal<'password' | 'code'>(this.auth.me()?.twoFactorPending ? 'code' : 'password');
  protected readonly replaced = signal(this.auth.signedOutReason() === 'replaced');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly emailError = signal('');
  protected readonly showPassword = signal(false);
  protected readonly capsLock = signal(false);
  /** The institution logo from Settings, shown on the dark panel (it is white, so no background behind it). */
  protected readonly logo = computed(() => this.site.media(this.site.setting('institution.logo_media_id')));

  constructor() {
    inject(Title).setTitle('Sign in | Admin');
    void this.site.load();
    afterNextRender(() => this.focusFirst());
  }

  protected checkEmail() {
    const v = this.email.trim();
    this.emailError.set(v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a full email address, e.g. name@institution.ac.ke' : '');
  }

  protected capsCheck(e: KeyboardEvent) {
    if (typeof e.getModifierState === 'function') this.capsLock.set(e.getModifierState('CapsLock'));
  }

  protected onCode(value: string) {
    this.code = (value ?? '').replace(/\D/g, '').slice(0, 6);
  }

  async signIn() {
    this.checkEmail();
    if (!this.email.trim() || !this.password) {
      this.error.set('Enter your email and password.');
      return;
    }
    if (this.emailError()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.auth.login(this.email.trim(), this.password);
      this.password = '';
      if (res.twoFactorRequired) {
        this.step.set('code');
        setTimeout(() => this.focusFirst());
      } else await this.continue();
    } catch (err) {
      // Opening the sign-in link lets this page be used for a few minutes; after that it needs the link again.
      this.error.set((await this.auth.portalAccess()).granted ? errorMessage(err) : this.timedOutMessage());
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.verify(this.code.trim());
      await this.continue();
    } catch (err) {
      this.error.set(errorMessage(err));
      this.code = '';
      setTimeout(() => this.focusFirst());
    } finally {
      this.busy.set(false);
    }
  }

  async startOver() {
    await this.auth.logout();
    if (!this.route.snapshot.paramMap.has('token') && !(await this.auth.portalAccess()).granted) {
      await this.router.navigateByUrl('/');
      return;
    }
    this.step.set('password');
    this.error.set('');
    this.code = '';
    setTimeout(() => this.focusFirst());
  }

  private timedOutMessage() {
    return this.route.snapshot.paramMap.has('token')
      ? 'This sign-in page has timed out. Reload the page to continue.'
      : 'This sign-in page has timed out. Open your sign-in link again to continue.';
  }

  private focusFirst() {
    (this.step() === 'code' ? this.codeInput() : this.emailInput())?.nativeElement.focus();
  }

  private async continue() {
    const me = this.auth.me();
    await this.router.navigateByUrl(me?.twoFactorSetupRequired ? '/admin/two-step-setup' : '/admin');
  }
}
