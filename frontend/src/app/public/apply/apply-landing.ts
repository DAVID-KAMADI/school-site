import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, Injector, PLATFORM_ID, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { ApplicantApi, formatMoney, type AdmissionsOptions, type FeeInfo } from '../../core/admissions';
import { AuthStore } from '../../core/auth';
import { SiteStore } from '../../core/site';

/** /apply: what you need to know, then create an account or sign in. */
@Component({
  selector: 'app-apply-landing',
  imports: [FormsModule, DatePipe],
  templateUrl: './apply-landing.html',
  styleUrl: './apply.scss',
})
export class ApplyLanding {
  protected readonly site = inject(SiteStore);
  private readonly api = inject(ApplicantApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly options = signal<AdmissionsOptions | null>(null);
  protected readonly mode = signal<'register' | 'signin' | 'forgot'>('register');
  /** A confirmation shown above the form (reset link sent, password changed). */
  protected readonly notice = signal('');
  private readonly forgotEmail = viewChild<ElementRef<HTMLInputElement>>('forgotEmail');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly fee = computed(() => this.options()?.settings['admissions.fee'] as FeeInfo | undefined);
  protected readonly feeText = computed(() => formatMoney(this.fee()));
  protected readonly welcome = computed(() => (this.options()?.settings['admissions.welcome'] as string) ?? '');

  protected fullName = '';
  protected email = '';
  protected phone = '';
  protected password = '';
  protected acceptTerms = false;

  /** The consent sentence with {terms} and {privacy} turned into links to the legal pages. */
  protected readonly consentParts = computed(() => {
    const raw = this.site.t(
      'apply.register.consent',
      'I have read and agree to the {terms} and the {privacy}, and I agree that {institution_name} may use my information to process my application.',
    );
    const links: Record<string, { text: string; href: string }> = {
      '{terms}': { text: this.site.t('legal.terms_link', 'Terms of Service'), href: this.site.setting<string>('legal.terms_path') || '/terms-of-service' },
      '{privacy}': { text: this.site.t('legal.privacy_link', 'Privacy Policy'), href: this.site.setting<string>('legal.privacy_path') || '/privacy-policy' },
    };
    return raw
      .split(/(\{terms\}|\{privacy\})/)
      .filter(Boolean)
      .map((piece) => links[piece] ?? { text: piece, href: '' });
  });

  constructor() {
    inject(Title).setTitle(`${this.site.t('apply.title', 'Apply for admission')} | ${this.site.institutionName()}`);
    const meta = inject(Meta);
    void this.api.options().then((o) => {
      this.options.set(o);
      const text = (o.settings['admissions.welcome'] as string) || 'Apply for admission online.';
      meta.updateTag({ name: 'description', content: text });
    }).catch(() => this.options.set({ programmes: [], intakes: [], documentTypes: [], settings: {} }));
    // Back from /apply/reset-password: open the sign-in tab with a confirmation.
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('reset') === 'done') {
      this.mode.set('signin');
      this.notice.set('Your password has been changed. Sign in with your new password.');
    }
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      void this.auth.refresh().then((me) => {
        if (me && this.auth.can('applications.apply')) void this.router.navigateByUrl('/apply/application');
      });
    }
  }

  protected showForgot() {
    this.mode.set('forgot');
    this.error.set('');
    this.notice.set('');
    this.password = '';
    afterNextRender(() => this.forgotEmail()?.nativeElement.focus(), { injector: this.injector });
  }

  protected showSignIn() {
    this.mode.set('signin');
    this.error.set('');
  }

  /** The reply is the same whether or not the email has an account, so the form cannot be used to find out who has applied. */
  async sendResetLink() {
    const email = this.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error.set('Enter the email address you registered with.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.ensureCsrf();
      const { message } = await this.api.requestPasswordReset(email);
      this.mode.set('signin');
      this.notice.set(message);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.auth.ensureCsrf();
      if (this.mode() === 'register') {
        if (!this.acceptTerms) {
          this.error.set('Please agree to the Terms of Service and Privacy Policy to create an account.');
          return;
        }
        await this.api.register({ fullName: this.fullName.trim(), email: this.email.trim(), phone: this.phone.trim(), password: this.password, acceptTerms: true });
        await this.auth.refresh();
      } else {
        await this.auth.login(this.email.trim(), this.password);
      }
      this.password = '';
      if (!this.auth.can('applications.apply')) {
        this.error.set('This is a staff account. Staff sign in at /admin.');
        await this.auth.logout();
        return;
      }
      await this.router.navigateByUrl('/apply/application');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
