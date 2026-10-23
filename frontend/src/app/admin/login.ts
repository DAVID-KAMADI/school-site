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
          <div class="brand__mark">
            @if (logo(); as img) {
              <img [src]="img.url" alt="" />
            } @else {
              <span>{{ initials() }}</span>
            }
          </div>
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
            <span class="login-card__mark" aria-hidden="true">
              @if (logo(); as img) {
                <img [src]="img.url" alt="" />
              } @else {
                {{ initials() }}
              }
            </span>
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
          @if (denied()) {
            <div class="a-alert a-alert--warning">Your account does not have access to the admin portal.</div>
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
  styles: `
    .login { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); background: var(--a-bg); }

    .brand {
      position: relative; overflow: hidden; color: #fff; display: flex; align-items: center; padding: clamp(2rem, 5vw, 4.5rem);
      background:
        radial-gradient(circle at 15% 15%, rgb(255 255 255 / 0.12), transparent 40%),
        radial-gradient(circle at 85% 90%, rgb(239 109 0 / 0.35), transparent 45%),
        linear-gradient(150deg, var(--a-navy-2), var(--a-navy));
    }
    .brand::after {
      content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.08;
      background-image: linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px);
      background-size: 44px 44px;
    }
    .brand__inner { position: relative; z-index: 1; max-width: 30rem; }
    .brand__mark { min-width: 3.5rem; width: fit-content; padding: 0 0.6rem; height: 3.5rem; border-radius: 14px; background: var(--a-accent); display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; overflow: hidden; }
    .brand__mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
    .brand__name { margin: 1.25rem 0 0; font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; font-weight: 600; }
    .brand__title { margin: 0.35rem 0 0.75rem; font-size: clamp(2rem, 3.4vw, 2.8rem); line-height: 1.1; letter-spacing: -0.02em; color: #fff; }
    .brand__text { margin: 0 0 2rem; font-size: 1.05rem; line-height: 1.6; opacity: 0.88; }
    .brand__points { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.85rem; }
    .brand__points li { display: flex; align-items: center; gap: 0.7rem; font-size: 0.95rem; opacity: 0.92; }
    .brand__points app-icon { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 8px; background: rgb(255 255 255 / 0.12); }

    .panel { display: grid; place-items: center; padding: clamp(1.25rem, 4vw, 3rem); }
    .login-card { width: min(100%, 27rem); background: #fff; border: 1px solid var(--a-line); border-radius: 18px; padding: clamp(1.5rem, 4vw, 2.5rem); box-shadow: 0 1px 2px rgb(16 24 40 / 0.04), 0 12px 32px rgb(16 24 40 / 0.08); }
    .login-card__top { display: none; align-items: center; gap: 0.6rem; margin-bottom: 1.5rem; }
    .login-card__mark { min-width: 2.4rem; width: fit-content; padding: 0 0.4rem; height: 2.4rem; border-radius: 10px; background: var(--a-accent); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 0.9rem; overflow: hidden; }
    .login-card__mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
    .login-card__eyebrow { margin: 0; font-weight: 700; font-size: 0.85rem; color: var(--a-text); }
    h1 { margin: 0; font-size: 1.75rem; letter-spacing: -0.02em; color: var(--a-text); }
    .lead { margin: 0.4rem 0 1.5rem; color: var(--a-muted); }

    .form { display: grid; gap: 1.1rem; }
    .field { display: grid; gap: 0.4rem; }
    .field > span:first-child { font-weight: 600; font-size: 0.9rem; color: var(--a-text); }
    .control {
      display: flex; align-items: center; gap: 0.6rem; padding: 0 0.85rem; min-height: 3rem; border: 1.5px solid var(--a-line-strong); border-radius: 10px; background: #fff;
      color: var(--a-muted); transition: border-color 0.15s, box-shadow 0.15s;
    }
    .control:focus-within { border-color: var(--a-primary); box-shadow: 0 0 0 4px var(--a-primary-soft); color: var(--a-primary); }
    .control input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 1rem; color: var(--a-text); padding: 0.7rem 0; }
    .control input::placeholder { color: #9aa3b2; }
    .control:has(input[aria-invalid='true']) { border-color: var(--a-danger); }
    .pw-toggle { border: 0; background: none; font: inherit; font-size: 0.85rem; font-weight: 600; color: var(--a-primary); cursor: pointer; padding: 0.35rem 0.2rem; border-radius: 6px; }
    .pw-toggle:focus-visible { outline: 2px solid var(--a-primary); }
    .field__error { color: var(--a-danger); font-size: 0.85rem; }
    .field__hint { color: var(--a-accent-text); font-size: 0.85rem; font-weight: 600; }

    .code { width: 100%; min-height: 3.5rem; border: 1.5px solid var(--a-line-strong); border-radius: 10px; font: inherit; font-size: 1.75rem; font-weight: 700; letter-spacing: 0.55em; text-align: center; padding-left: 0.55em; }
    .code:focus { outline: 0; border-color: var(--a-primary); box-shadow: 0 0 0 4px var(--a-primary-soft); }

    .submit {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 3rem; border: 0; border-radius: 10px; cursor: pointer;
      background: var(--a-primary); color: #fff; font: inherit; font-weight: 700; font-size: 1rem; transition: background 0.15s, transform 0.05s;
    }
    .submit:hover:not(:disabled) { background: var(--a-primary-strong); }
    .submit:active:not(:disabled) { transform: translateY(1px); }
    .submit:focus-visible { outline: 3px solid var(--a-accent); outline-offset: 2px; }
    .submit:disabled { opacity: 0.65; cursor: default; }
    .spinner { width: 1rem; height: 1rem; border: 2px solid rgb(255 255 255 / 0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }

    .help { margin: 0; font-size: 0.85rem; color: var(--a-muted); }
    .link { justify-self: center; border: 0; background: none; font: inherit; color: var(--a-primary); font-weight: 600; cursor: pointer; text-decoration: underline; }
    .back { display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 2rem; font-size: 0.88rem; color: var(--a-muted); text-decoration: none; }
    .back:hover { color: var(--a-primary); }

    @media (max-width: 860px) {
      .login { grid-template-columns: 1fr; }
      .brand { display: none; }
      .login-card__top { display: flex; }
      .panel { align-items: start; padding-top: 3rem; }
    }
  `,
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
  protected readonly step = signal<'password' | 'code'>(this.route.snapshot.queryParamMap.get('step') === 'code' ? 'code' : 'password');
  protected readonly denied = signal(this.route.snapshot.queryParamMap.has('denied'));
  protected readonly replaced = signal(this.route.snapshot.queryParamMap.get('reason') === 'replaced');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly emailError = signal('');
  protected readonly showPassword = signal(false);
  protected readonly capsLock = signal(false);
  protected readonly logo = computed(() => this.site.media(this.site.setting('institution.logo_media_id')));
  /** The short name (e.g. RCTI) when there is no logo, else the full name's initials. */
  protected readonly initials = computed(() => {
    const short = this.site.setting<string>('institution.short_name')?.trim();
    if (short && short.length <= 5) return short.toUpperCase();
    return (this.site.institutionName() || 'Admin')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 4)
      .toUpperCase();
  });

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
      this.error.set(errorMessage(err));
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
    this.step.set('password');
    this.error.set('');
    this.code = '';
    setTimeout(() => this.focusFirst());
  }

  private focusFirst() {
    (this.step() === 'code' ? this.codeInput() : this.emailInput())?.nativeElement.focus();
  }

  private async continue() {
    const me = this.auth.me();
    await this.router.navigateByUrl(me?.twoFactorSetupRequired ? '/admin/two-step-setup' : '/admin');
  }
}
