import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type MessagingSettings, type SendOutcome } from '../api';

/** How many SMS a message uses: 160 characters for one, 153 per part after that (70 / 67 with emoji etc.). */
export function smsParts(text: string): { parts: number; unicode: boolean } {
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà€]/.test(text);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return { parts: !text.length ? 0 : text.length <= single ? 1 : Math.ceil(text.length / multi), unicode };
}

/**
 * SMS & email: where the Africa's Talking account and the mail server are entered, with a test
 * message for each so you can see straight away whether they work. Super administrators only.
 */
@Component({
  selector: 'app-messaging-settings',
  imports: [FormsModule],
  template: `
    <h1>SMS &amp; email</h1>
    <p class="a-muted intro">
      The accounts the site uses to send messages, for example follow-ups to applicants who have not finished their
      application (Admissions → Follow-ups). Keys and passwords are stored encrypted and never shown again after saving.
    </p>

    @if (error(); as e) {
      <div class="a-alert a-alert--error" role="alert">{{ e }}</div>
    }

    @if (settings(); as s) {
      <!-- SMS -->
      <section class="a-panel a-stack">
        <header class="head">
          <h2>SMS: Africa’s Talking</h2>
          <span class="a-badge" [class.a-badge--live]="s.sms.ready">{{ s.sms.ready ? 'Set up' : 'Not set up' }}</span>
        </header>
        <p class="a-help">
          From your Africa’s Talking dashboard: Settings → API Key. Use the sandbox while testing (messages appear in the
          Africa’s Talking simulator, not on real phones, and cost nothing), then switch to Live with your app’s username.
        </p>

        <form class="a-stack" (ngSubmit)="saveSms()">
          <div class="a-field">
            <span class="a-label">Environment</span>
            <div class="a-row">
              <label class="a-check"><input type="radio" name="env" value="sandbox" [(ngModel)]="sms.environment" (ngModelChange)="envChanged()" /> Sandbox (testing)</label>
              <label class="a-check"><input type="radio" name="env" value="live" [(ngModel)]="sms.environment" (ngModelChange)="envChanged()" /> Live (real phones, uses credit)</label>
            </div>
          </div>
          <div class="grid">
            <label class="a-field">
              <span>Username</span>
              <input class="a-input" name="username" [(ngModel)]="sms.username" [readonly]="sms.environment === 'sandbox'" autocomplete="off" />
              <span class="a-help">{{ sms.environment === 'sandbox' ? 'Always "sandbox" in the sandbox.' : 'Your Africa’s Talking app username.' }}</span>
            </label>
            <label class="a-field">
              <span>API key</span>
              <input class="a-input" name="apiKey" type="password" [(ngModel)]="sms.apiKey" autocomplete="new-password"
                [placeholder]="s.sms.apiKeySet ? 'Saved (ends ' + s.sms.apiKeyHint + '): leave empty to keep' : 'Paste the API key'" />
            </label>
            <label class="a-field">
              <span>Sender ID <span class="a-muted">(optional)</span></span>
              <input class="a-input" name="senderId" maxlength="11" [(ngModel)]="sms.senderId" placeholder="e.g. RCMRD" autocomplete="off" />
              <span class="a-help">Only once Africa’s Talking has approved it. Empty uses their default sender.</span>
            </label>
          </div>
          <div class="a-row">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">Save SMS settings</button>
          </div>
        </form>

        <div class="test">
          <h3>Send a test SMS</h3>
          <form class="a-row test-row" (ngSubmit)="testSms()">
            <label class="a-field">
              <span>Phone number</span>
              <input class="a-input" name="testPhone" [(ngModel)]="testPhone" placeholder="0712 345 678" inputmode="tel" />
            </label>
            <label class="a-field grow">
              <span>Message</span>
              <input class="a-input" name="testText" maxlength="480" [(ngModel)]="testText" />
              <span class="a-help">{{ testText.length }} characters · {{ parts(testText).parts }} SMS{{ parts(testText).unicode ? ' (special characters make each SMS shorter)' : '' }}</span>
            </label>
            <button class="a-btn" type="submit" [disabled]="busy() || !s.sms.ready || !testPhone.trim() || !testText.trim()">Send test SMS</button>
          </form>
          @if (!s.sms.ready) {
            <p class="a-help">Save the username and API key first.</p>
          }
          @if (smsResult(); as r) {
            <div class="a-alert" [class]="r.ok ? 'a-alert--success' : 'a-alert--error'" role="status">
              @if (r.ok) {
                <strong>Accepted by Africa’s Talking</strong> for {{ r.recipient }}: {{ r.providerStatus }}{{ r.cost ? ', cost ' + r.cost : '' }}.
                @if (s.sms.environment === 'sandbox') {
                  Open the simulator at simulator.africastalking.com and enter {{ r.recipient }} to see it.
                }
              } @else {
                <strong>Not sent.</strong> {{ r.error }}
              }
            </div>
          }
        </div>
      </section>

      <!-- Email -->
      <section class="a-panel a-stack">
        <header class="head">
          <h2>Email: mail server (SMTP)</h2>
          <span class="a-badge" [class.a-badge--live]="s.email.ready">{{ s.email.ready ? 'Set up' : 'Not set up' }}</span>
        </header>
        <p class="a-help">
          The details from your email provider. Gmail / Google Workspace: smtp.gmail.com, port 587, STARTTLS, with an app
          password. Microsoft 365: smtp.office365.com, port 587, STARTTLS.
        </p>
        <form class="a-stack" (ngSubmit)="saveEmail()">
          <div class="grid">
            <label class="a-field">
              <span>Mail server</span>
              <input class="a-input" name="host" [(ngModel)]="email.host" placeholder="smtp.gmail.com" autocomplete="off" />
            </label>
            <label class="a-field">
              <span>Port</span>
              <input class="a-input" name="port" type="number" min="1" max="65535" [(ngModel)]="email.port" />
            </label>
            <label class="a-field">
              <span>Security</span>
              <select class="a-select" name="security" [(ngModel)]="email.security">
                <option value="starttls">STARTTLS (usually port 587)</option>
                <option value="tls">TLS/SSL (usually port 465)</option>
                <option value="none">None (not recommended)</option>
              </select>
            </label>
            <label class="a-field">
              <span>Username</span>
              <input class="a-input" name="smtpUser" [(ngModel)]="email.username" autocomplete="off" />
            </label>
            <label class="a-field">
              <span>Password</span>
              <input class="a-input" name="smtpPassword" type="password" [(ngModel)]="email.password" autocomplete="new-password"
                [placeholder]="s.email.passwordSet ? 'Saved: leave empty to keep' : 'Password or app password'" />
            </label>
            <label class="a-field">
              <span>From name</span>
              <input class="a-input" name="fromName" [(ngModel)]="email.fromName" placeholder="Admissions Office" />
            </label>
            <label class="a-field">
              <span>From address</span>
              <input class="a-input" name="fromEmail" type="email" [(ngModel)]="email.fromEmail" placeholder="admissions@example.ac.ke" />
            </label>
            <label class="a-field">
              <span>Replies go to <span class="a-muted">(optional)</span></span>
              <input class="a-input" name="replyTo" type="email" [(ngModel)]="email.replyTo" />
            </label>
          </div>
          <div class="a-row">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="busy()">Save email settings</button>
          </div>
        </form>

        <div class="test">
          <h3>Send a test email</h3>
          <form class="a-row test-row" (ngSubmit)="testEmail()">
            <label class="a-field grow">
              <span>Send to</span>
              <input class="a-input" name="testTo" type="email" [(ngModel)]="testTo" />
            </label>
            <button class="a-btn" type="submit" [disabled]="busy() || !s.email.ready || !testTo.trim()">Send test email</button>
          </form>
          @if (emailResult(); as r) {
            <div class="a-alert" [class]="r.ok ? 'a-alert--success' : 'a-alert--error'" role="status">
              @if (r.ok) {
                <strong>Sent</strong> to {{ r.recipient }}. Check the inbox (and the spam folder).
              } @else {
                <strong>Not sent.</strong> {{ r.error }}
              }
            </div>
          }
        </div>
      </section>
    }

    @if (saved(); as m) {
      <div class="a-alert a-alert--success toast" role="status">{{ m }}</div>
    }
  `,
  styles: `
    .intro { max-width: 75ch; }
    .a-panel { margin-top: 1rem; }
    .head { display: flex; align-items: center; gap: 0.75rem; }
    .head h2 { margin: 0; font-size: 1.1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; }
    .test { border-top: 1px solid var(--a-line); padding-top: 1rem; display: grid; gap: 0.75rem; }
    .test h3 { margin: 0; font-size: 1rem; }
    .test-row { flex-wrap: wrap; align-items: flex-end; }
    .test-row .grow { flex: 1 1 18rem; }
    .toast { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 50; box-shadow: var(--a-shadow); }
  `,
})
export class MessagingSettingsPage {
  private readonly api = inject(AdminApi);
  protected readonly settings = signal<MessagingSettings | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal<string | null>(null);
  protected readonly smsResult = signal<SendOutcome | null>(null);
  protected readonly emailResult = signal<SendOutcome | null>(null);

  protected sms = { username: 'sandbox', apiKey: '', senderId: '', environment: 'sandbox' as 'sandbox' | 'live' };
  protected email = {
    host: '',
    port: 587,
    security: 'starttls' as 'tls' | 'starttls' | 'none',
    username: '',
    password: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
  };
  private liveUsername = '';

  protected testPhone = '';
  protected testText = 'Test message from the website. If you received this, SMS sending works.';
  protected readonly parts = smsParts;
  protected testTo = '';

  constructor() {
    inject(Title).setTitle('SMS & email | Admin');
    void this.load();
  }

  private async load() {
    try {
      this.fill(await this.api.messagingSettings());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private fill(s: MessagingSettings) {
    this.settings.set(s);
    this.sms = { username: s.sms.username, apiKey: '', senderId: s.sms.senderId, environment: s.sms.environment };
    if (s.sms.environment === 'live') this.liveUsername = s.sms.username;
    const { passwordSet: _p, ready: _r, ...email } = s.email;
    this.email = { ...email, password: '' };
  }

  protected envChanged() {
    if (this.sms.environment === 'sandbox') {
      if (this.sms.username !== 'sandbox') this.liveUsername = this.sms.username;
      this.sms.username = 'sandbox';
    } else if (this.sms.username === 'sandbox') this.sms.username = this.liveUsername;
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(errorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      this.busy.set(false);
    }
  }

  private flash(text: string) {
    this.saved.set(text);
    setTimeout(() => this.saved.set(null), 4000);
  }

  protected saveSms() {
    return this.run(async () => {
      const changedKey = !!this.sms.apiKey.trim();
      this.fill(
        await this.api.saveSmsSettings({
          username: this.sms.username.trim(),
          apiKey: this.sms.apiKey.trim() || undefined,
          senderId: this.sms.senderId.trim(),
          environment: this.sms.environment,
        }),
      );
      this.smsResult.set(null);
      this.flash(changedKey ? 'SMS settings saved. The API key is stored encrypted.' : 'SMS settings saved.');
    });
  }

  protected saveEmail() {
    return this.run(async () => {
      this.fill(
        await this.api.saveEmailSettings({
          ...this.email,
          port: Number(this.email.port),
          password: this.email.password.trim() || undefined,
        }),
      );
      this.emailResult.set(null);
      this.flash('Email settings saved.');
    });
  }

  protected testSms() {
    return this.run(async () => {
      this.smsResult.set(null);
      this.smsResult.set(await this.api.testSms(this.testPhone.trim(), this.testText.trim()));
    });
  }

  protected testEmail() {
    return this.run(async () => {
      this.emailResult.set(null);
      this.emailResult.set(await this.api.testEmail(this.testTo.trim()));
    });
  }
}
