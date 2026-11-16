import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type FollowUpPerson, type FollowUpStage, type FollowUpSummary, type MessageLogRow } from '../api';
import { smsParts } from '../system/messaging-settings';
import { AdmissionsAdminApi, type IntakeRow } from './admissions-api';

interface Template {
  label: string;
  sms: string;
  subject: string;
  body: string;
}

/** Ready-made wording for each stage; staff can change it before sending. */
const TEMPLATES: Record<FollowUpStage, Template[]> = {
  draft: [
    {
      label: 'Gentle reminder',
      sms: 'Hi {first_name}, your application for {programme} at {institution} is not finished yet. Still to do: {missing}. Continue here: {link}',
      subject: 'Your application for {programme} is waiting for you',
      body:
        'Dear {first_name},\n\nThank you for starting your application for {programme} ({intake}) at {institution}.\n\nIt has not been submitted yet. Still to complete: {missing}.\n\nYou can continue where you left off here: {link}\n\nIf you need any help, simply reply to this email.\n\nKind regards,\nAdmissions Office',
    },
    {
      label: 'Deadline approaching',
      sms: 'Hi {first_name}, applications for {intake} close on {deadline}. Please complete your {programme} application: {link}',
      subject: 'Applications close on {deadline}',
      body:
        'Dear {first_name},\n\nThis is a reminder that applications for the {intake} intake close on {deadline}.\n\nYour application for {programme} is still incomplete. Still to complete: {missing}.\n\nFinish it here: {link}\n\nKind regards,\nAdmissions Office',
    },
  ],
  info_requested: [
    {
      label: 'Information still needed',
      sms: 'Hi {first_name}, we still need some information to process your {programme} application. Please sign in: {link}',
      subject: 'We need a little more information for your application',
      body:
        'Dear {first_name},\n\nWe asked for some more information about your application for {programme}, and have not received it yet.\n\nPlease sign in and see what is needed: {link}\n\nWe cannot complete the review of your application until we have it.\n\nKind regards,\nAdmissions Office',
    },
  ],
  not_started: [
    {
      label: 'Start your application',
      sms: 'Hi {first_name}, thank you for creating an account with {institution}. You can now start your application: {link}',
      subject: 'Ready to start your application?',
      body:
        'Dear {first_name},\n\nThank you for creating an account with {institution}.\n\nYou have not started an application yet. It only takes a few minutes to begin, and you can save and come back at any time: {link}\n\nIf you have any questions about our courses, simply reply to this email.\n\nKind regards,\nAdmissions Office',
    },
  ],
};

const STAGES: { key: FollowUpStage; label: string; help: string }[] = [
  { key: 'draft', label: 'Started, not submitted', help: 'Began an application but never submitted it.' },
  { key: 'info_requested', label: 'Information requested', help: 'Were asked for more information and have not sent it.' },
  { key: 'not_started', label: 'Account only', help: 'Created an account but never started an application.' },
];

/**
 * Admissions → Follow-ups: lists applicants who stopped part-way and sends them an SMS and/or email,
 * filled in with their own name, course and what is still missing.
 */
@Component({
  selector: 'app-follow-ups',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="a-toolbar a-toolbar--spread">
      <h1>Follow-ups</h1>
      <button class="a-btn" type="button" (click)="toggleHistory()">{{ showHistory() ? 'Back to follow-ups' : 'Messages sent' }}</button>
    </div>
    <p class="a-muted intro">
      Remind people who started but did not finish. Choose who to contact, write the message (or pick a ready-made one) and
      send it by SMS, email or both. Each message is filled in with the person’s own name, course and what is still missing.
    </p>

    @if (error(); as e) {
      <div class="a-alert a-alert--error" role="alert">{{ e }}</div>
    }

    @if (channels(); as ch) {
      @if (!ch.sms || !ch.email) {
        <div class="a-alert a-alert--warning">
          {{ !ch.sms && !ch.email ? 'SMS and email are' : !ch.sms ? 'SMS is' : 'Email is' }} not set up yet.
          @if (isSuperAdmin) {
            Add the details under <a routerLink="/admin/messaging">System → SMS &amp; email</a>.
          } @else {
            Ask a super administrator to add the details under System → SMS &amp; email.
          }
        </div>
      }
    }

    @if (showHistory()) {
      <section class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>When</th><th>To</th><th>Message</th><th>Result</th><th>By</th></tr></thead>
          <tbody>
            @for (m of history(); track m.id) {
              <tr>
                <td class="nowrap">{{ m.at | date: 'd MMM, HH:mm' }}</td>
                <td>
                  {{ m.recipientName ?? m.recipient }}
                  <div class="a-small a-muted">{{ m.channel === 'sms' ? 'SMS' : 'Email' }} · {{ m.recipient }}{{ m.purpose === 'test' ? ' · test' : '' }}</div>
                </td>
                <td class="msg">
                  @if (m.subject) {<strong>{{ m.subject }}</strong><br />}
                  <span class="a-small">{{ m.body.length > 160 ? m.body.slice(0, 160) + '…' : m.body }}</span>
                </td>
                <td>
                  <span class="a-badge" [class.a-badge--live]="m.status === 'sent'" [class.bad]="m.status === 'failed'">{{ m.status === 'sent' ? 'Sent' : 'Failed' }}</span>
                  @if (m.error) {<div class="a-small a-muted">{{ m.error }}</div>}
                  @if (m.cost) {<div class="a-small a-muted">{{ m.cost }}</div>}
                </td>
                <td class="a-small">{{ m.sentBy ?? '' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="a-empty">No messages sent yet.</td></tr>
            }
          </tbody>
        </table>
      </section>
    } @else {
      <div class="tabs" role="tablist">
        @for (s of stages; track s.key) {
          <button type="button" role="tab" class="tab" [class.on]="stage() === s.key" [attr.aria-selected]="stage() === s.key" (click)="setStage(s.key)" [title]="s.help">
            {{ s.label }}
          </button>
        }
      </div>

      <form class="a-row filters" (ngSubmit)="load()">
        <input class="a-input" name="search" [(ngModel)]="search" placeholder="Search name, email or phone" aria-label="Search" />
        @if (stage() !== 'not_started' && intakes().length) {
          <select class="a-select" name="intake" [(ngModel)]="intakeId" (ngModelChange)="load()" aria-label="Intake">
            <option value="">All intakes</option>
            @for (i of intakes(); track i.id) {<option [value]="i.id">{{ i.name }}</option>}
          </select>
        }
        <select class="a-select" name="inactive" [(ngModel)]="inactiveDays" (ngModelChange)="load()" aria-label="Inactive for">
          <option value="">Any last activity</option>
          <option value="2">Inactive 2+ days</option>
          <option value="7">Inactive 1+ week</option>
          <option value="14">Inactive 2+ weeks</option>
          <option value="30">Inactive 1+ month</option>
        </select>
        <button class="a-btn" type="submit">Search</button>
      </form>

      @if (total() > people().length) {
        <p class="a-small a-muted">Showing the {{ people().length }} most recently active of {{ total() }}. Use the filters to narrow the list.</p>
      }
      <section class="a-table-wrap">
        <table class="a-table">
          <thead>
            <tr>
              <th class="pick">
                <input type="checkbox" [checked]="allChosen()" [indeterminate]="someChosen()" (change)="chooseAll($any($event.target).checked)" aria-label="Choose everyone" />
              </th>
              <th>Applicant</th>
              @if (stage() !== 'not_started') {<th>Course</th><th>Progress</th>}
              <th>Last active</th>
              <th>Last followed up</th>
            </tr>
          </thead>
          <tbody>
            @for (p of people(); track p.userId) {
              <tr [class.chosen]="chosen().has(p.userId)">
                <td class="pick"><input type="checkbox" [checked]="chosen().has(p.userId)" (change)="toggle(p.userId)" [attr.aria-label]="'Choose ' + p.fullName" /></td>
                <td>
                  @if (p.applicationId) {
                    <a [routerLink]="['/admin/applications', p.applicationId]">{{ p.fullName }}</a>
                  } @else {
                    {{ p.fullName }}
                  }
                  <div class="a-small a-muted">{{ p.email }} · {{ p.phone || 'no phone' }}</div>
                </td>
                @if (stage() !== 'not_started') {
                  <td>{{ p.programme ?? 'Not chosen' }}<div class="a-small a-muted">{{ p.intake }}</div></td>
                  <td>
                    @if (p.progress; as pr) {
                      <div class="bar" [attr.aria-label]="pr.done + ' of ' + pr.total + ' sections done'"><span [style.width.%]="(pr.done / pr.total) * 100"></span></div>
                      <div class="a-small a-muted">{{ pr.done }}/{{ pr.total }}{{ pr.missing.length ? ' · missing ' + pr.missing.join(', ') : '' }}</div>
                    }
                  </td>
                }
                <td class="nowrap">{{ p.lastActivityAt | date: 'd MMM y' }}</td>
                <td class="nowrap">
                  @if (p.lastFollowUpAt) {
                    {{ p.lastFollowUpAt | date: 'd MMM' }}<div class="a-small a-muted">{{ p.followUps }} time{{ p.followUps === 1 ? '' : 's' }}</div>
                  } @else {
                    <span class="a-muted">Never</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="stage() === 'not_started' ? 4 : 6" class="a-empty">{{ loading() ? 'Loading…' : 'Nobody here. Everyone in this group has moved on.' }}</td></tr>
            }
          </tbody>
        </table>
      </section>

      <!-- Compose -->
      <section class="a-panel a-stack compose">
        <h2>Message {{ chosen().size ? 'for ' + chosen().size + (chosen().size === 1 ? ' person' : ' people') : '' }}</h2>
        <div class="a-row">
          <span class="a-label">Ready-made:</span>
          @for (t of templates(); track t.label) {
            <button type="button" class="a-btn a-btn--sm" (click)="useTemplate(t)">{{ t.label }}</button>
          }
        </div>
        <div class="a-row">
          <label class="a-check"><input type="checkbox" name="useSms" [(ngModel)]="useSms" /> Send SMS</label>
          <label class="a-check"><input type="checkbox" name="useEmail" [(ngModel)]="useEmail" /> Send email</label>
        </div>

        @if (useSms) {
          <label class="a-field">
            <span>SMS</span>
            <textarea class="a-textarea" rows="3" name="smsText" maxlength="480" [(ngModel)]="smsText"></textarea>
            <span class="a-help">{{ smsText.length }} characters before filling in · about {{ parts(smsText).parts }} SMS each. Names and links make it longer; the preview shows the real length.</span>
          </label>
        }
        @if (useEmail) {
          <label class="a-field">
            <span>Email subject</span>
            <input class="a-input" name="subject" maxlength="200" [(ngModel)]="emailSubject" />
          </label>
          <label class="a-field">
            <span>Email message</span>
            <textarea class="a-textarea" rows="9" name="emailBody" maxlength="5000" [(ngModel)]="emailBody"></textarea>
          </label>
        }
        <p class="a-help">
          Filled in for each person:
          @for (ph of placeholders; track ph) {<code>{{ ph }}</code> }
        </p>

        @if (preview(); as pv) {
          <div class="preview">
            <h3>Preview for {{ pv.name }}</h3>
            @if (useSms) {
              <p class="sms-bubble">{{ pv.smsText }}</p>
              <p class="a-small a-muted">{{ pv.smsText.length }} characters · {{ parts(pv.smsText).parts }} SMS</p>
            }
            @if (useEmail) {
              <p><strong>{{ pv.emailSubject }}</strong></p>
              <pre class="email">{{ pv.emailBody }}</pre>
            }
          </div>
        }

        @if (confirming()) {
          <div class="a-alert a-alert--warning confirm">
            <span>
              Send {{ what() }} to
              {{ chosen().size }} {{ chosen().size === 1 ? 'person' : 'people' }}?
              @if (useSms) { SMS uses Africa’s Talking credit. }
            </span>
            <span class="a-row">
              <button type="button" class="a-btn a-btn--primary" [disabled]="busy()" (click)="send()">{{ busy() ? 'Sending…' : 'Yes, send now' }}</button>
              <button type="button" class="a-btn" [disabled]="busy()" (click)="confirming.set(false)">Cancel</button>
            </span>
          </div>
        } @else {
          <div class="a-row">
            <button type="button" class="a-btn" [disabled]="busy() || !chosen().size" (click)="showPreview()">Preview</button>
            <button type="button" class="a-btn a-btn--primary" [disabled]="busy() || !canSend()" (click)="confirming.set(true)">
              Send to {{ chosen().size }} {{ chosen().size === 1 ? 'person' : 'people' }}
            </button>
          </div>
        }

        @if (result(); as r) {
          <div class="a-alert" [class]="failures(r) ? 'a-alert--warning' : 'a-alert--success'" role="status">
            <strong>Done.</strong>
            @if (r.sms) { SMS: {{ r.sms.sent }} sent{{ r.sms.failed ? ', ' + r.sms.failed + ' not sent' : '' }}. }
            @if (r.email) { Email: {{ r.email.sent }} sent{{ r.email.failed ? ', ' + r.email.failed + ' not sent' : '' }}. }
            @if (r.skipped) { {{ r.skipped }} skipped: they are no longer in this group. }
            @if (failures(r)) {
              <ul>
                @for (x of r.results; track x.userId) {
                  @if (x.sms && !x.sms.ok) {<li>{{ x.name }} (SMS {{ x.sms.recipient }}): {{ x.sms.error }}</li>}
                  @if (x.email && !x.email.ok) {<li>{{ x.name }} (email): {{ x.email.error }}</li>}
                }
              </ul>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .intro { max-width: 80ch; }
    .tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 1rem 0 0.75rem; border-bottom: 1px solid var(--a-line); }
    .tab { background: none; border: 0; border-bottom: 3px solid transparent; padding: 0.6rem 0.9rem; font: inherit; font-weight: 600; color: var(--a-muted); cursor: pointer; }
    .tab.on { color: var(--a-primary); border-bottom-color: var(--a-primary); }
    .filters { flex-wrap: wrap; margin-bottom: 0.75rem; }
    .filters .a-input { max-width: 18rem; }
    .filters .a-select { max-width: 13rem; }
    .pick { width: 2.5rem; }
    .pick input { accent-color: var(--a-primary); width: 1rem; height: 1rem; }
    tr.chosen { background: var(--a-primary-soft); }
    .nowrap { white-space: nowrap; }
    .bar { width: 7rem; height: 0.4rem; border-radius: 999px; background: var(--a-line); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--a-primary); }
    .bad { background: var(--a-danger-soft, #fde8e8); color: var(--a-danger, #b42318); }
    .msg { max-width: 32rem; }
    .compose { margin-top: 1rem; }
    .compose h2 { margin: 0; font-size: 1.1rem; }
    .preview { border: 1px dashed var(--a-line); border-radius: var(--a-radius); padding: 1rem; background: #fafbfc; }
    .preview h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
    .sms-bubble { display: inline-block; max-width: 26rem; margin: 0; padding: 0.6rem 0.8rem; border-radius: 1rem 1rem 1rem 0.25rem; background: #e9f0ff; white-space: pre-wrap; }
    .email { white-space: pre-wrap; font: inherit; margin: 0; }
    .confirm { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; }
    code { background: #eef1f5; padding: 0.05rem 0.3rem; border-radius: 4px; font-size: 0.82rem; }
  `,
})
export class FollowUps {
  private readonly api = inject(AdminApi);
  private readonly admissions = inject(AdmissionsAdminApi);
  protected readonly isSuperAdmin = !!inject(AuthStore).user()?.roles.includes('super_admin');
  protected readonly stages = STAGES;
  protected readonly parts = smsParts;
  protected readonly placeholders = ['first_name', 'full_name', 'programme', 'intake', 'deadline', 'missing', 'link', 'institution'].map((k) => `{${k}}`);

  protected readonly stage = signal<FollowUpStage>('draft');
  protected readonly people = signal<FollowUpPerson[]>([]);
  protected readonly total = signal(0);
  protected readonly chosen = signal<Set<number>>(new Set());
  protected readonly channels = signal<{ sms: boolean; email: boolean } | null>(null);
  protected readonly intakes = signal<IntakeRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<FollowUpSummary | null>(null);
  protected readonly preview = signal<{ name: string; smsText: string; emailSubject: string; emailBody: string } | null>(null);
  protected readonly confirming = signal(false);
  protected readonly showHistory = signal(false);
  protected readonly history = signal<MessageLogRow[]>([]);
  protected readonly templates = computed(() => TEMPLATES[this.stage()]);
  protected readonly allChosen = computed(() => this.people().length > 0 && this.chosen().size === this.people().length);
  protected readonly someChosen = computed(() => this.chosen().size > 0 && !this.allChosen());

  protected search = '';
  protected intakeId = '';
  protected inactiveDays = '';
  protected useSms = true;
  protected useEmail = true;
  protected smsText = '';
  protected emailSubject = '';
  protected emailBody = '';

  constructor() {
    inject(Title).setTitle('Follow-ups | Admin');
    this.useTemplate(TEMPLATES.draft[0]);
    void this.admissions.intakes().then((i) => this.intakes.set(i)).catch(() => undefined);
    void this.load();
  }

  protected async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.followUps({
        stage: this.stage(),
        intakeId: this.stage() === 'not_started' ? '' : this.intakeId,
        inactiveDays: this.inactiveDays,
        search: this.search.trim(),
      });
      this.people.set(r.people);
      this.total.set(r.total);
      this.channels.set(r.channels);
      // Keep only choices that are still in the list.
      const ids = new Set(r.people.map((p) => p.userId));
      this.chosen.set(new Set([...this.chosen()].filter((id) => ids.has(id))));
      if (!r.channels.sms) this.useSms = false;
      if (!r.channels.email) this.useEmail = false;
      if (!r.channels.sms && !r.channels.email) this.useSms = this.useEmail = true;
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected setStage(s: FollowUpStage) {
    if (s === this.stage()) return;
    this.stage.set(s);
    this.chosen.set(new Set());
    this.preview.set(null);
    this.result.set(null);
    this.confirming.set(false);
    this.useTemplate(TEMPLATES[s][0]);
    void this.load();
  }

  protected toggle(id: number) {
    const next = new Set(this.chosen());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.chosen.set(next);
    this.confirming.set(false);
  }

  protected chooseAll(on: boolean) {
    this.chosen.set(on ? new Set(this.people().slice(0, 300).map((p) => p.userId)) : new Set());
    if (on && this.people().length > 300) this.error.set('At most 300 people at a time: the first 300 are chosen.');
    this.confirming.set(false);
  }

  protected useTemplate(t: Template) {
    this.smsText = t.sms;
    this.emailSubject = t.subject;
    this.emailBody = t.body;
    this.preview.set(null);
  }

  protected canSend() {
    return (
      this.chosen().size > 0 &&
      (this.useSms || this.useEmail) &&
      (!this.useSms || !!this.smsText.trim()) &&
      (!this.useEmail || (!!this.emailSubject.trim() && !!this.emailBody.trim()))
    );
  }

  protected async showPreview() {
    const first = this.people().find((p) => this.chosen().has(p.userId));
    if (!first) return;
    this.error.set(null);
    try {
      const pv = await this.api.previewFollowUp({
        stage: this.stage(),
        userId: first.userId,
        smsText: this.smsText,
        emailSubject: this.emailSubject,
        emailBody: this.emailBody,
      });
      this.preview.set({ name: first.fullName, ...pv });
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async send() {
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const channels: ('sms' | 'email')[] = [];
      if (this.useSms) channels.push('sms');
      if (this.useEmail) channels.push('email');
      this.result.set(
        await this.api.sendFollowUp({
          stage: this.stage(),
          userIds: [...this.chosen()],
          channels,
          smsText: this.useSms ? this.smsText : undefined,
          emailSubject: this.useEmail ? this.emailSubject : undefined,
          emailBody: this.useEmail ? this.emailBody : undefined,
        }),
      );
      this.chosen.set(new Set());
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }

  protected what() {
    return [this.useSms && 'an SMS', this.useEmail && 'an email'].filter(Boolean).join(' and ');
  }

  protected failures(r: FollowUpSummary) {
    return (r.sms?.failed ?? 0) + (r.email?.failed ?? 0);
  }

  protected async toggleHistory() {
    const on = !this.showHistory();
    this.showHistory.set(on);
    if (on) {
      try {
        this.history.set(await this.api.messageHistory());
      } catch (err) {
        this.error.set(errorMessage(err));
      }
    }
  }
}
