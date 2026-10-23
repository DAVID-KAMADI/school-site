import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { FEE_LABELS, STATUS_LABELS } from '../../core/admissions';
import { AdmissionsAdminApi, type ApplicationRow, type IntakeRow, type ProgrammeRow } from './admissions-api';

const PIPELINE = ['submitted', 'under_review', 'info_requested', 'offered', 'accepted', 'declined', 'rejected', 'withdrawn'];

/** Admissions officers' list: pipeline counts, filters, search and export. */
@Component({
  selector: 'app-applications-list',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <h1>Applications</h1>
      <div class="a-toolbar">
        <a class="a-btn" [href]="exportUrl()" download>Export to Excel (CSV)</a>
        <a class="a-btn" [href]="exportPdfUrl()" target="_blank" rel="noopener">Export to PDF</a>
      </div>
    </div>
    @if (error()) {
      <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
    }

    <div class="pipeline" role="tablist" aria-label="Filter by status">
      <button type="button" role="tab" class="chip" [class.chip--on]="!status" (click)="setStatus('')">All submitted <b>{{ totalSubmitted() }}</b></button>
      @for (s of pipeline; track s) {
        <button type="button" role="tab" class="chip" [class]="'chip chip--' + s" [class.chip--on]="status === s" (click)="setStatus(s)">{{ statusLabels[s] }} <b>{{ counts()[s] ?? 0 }}</b></button>
      }
    </div>
    <p class="a-small a-muted">{{ counts()['draft'] ?? 0 }} applicant(s) have started but not yet submitted.</p>

    <form class="a-toolbar filters" (ngSubmit)="load(1)">
      <input class="a-input" type="search" name="search" placeholder="Name, application no., KCSE index, phone or email" [(ngModel)]="search" aria-label="Search" />
      <select class="a-select" name="programme" [(ngModel)]="programmeId" (ngModelChange)="load(1)" aria-label="Programme">
        <option value="">All programmes</option>
        @for (p of programmes(); track p.id) {<option [value]="p.id">{{ p.name }}</option>}
      </select>
      <select class="a-select" name="intake" [(ngModel)]="intakeId" (ngModelChange)="load(1)" aria-label="Intake">
        <option value="">All intakes</option>
        @for (i of intakes(); track i.id) {<option [value]="i.id">{{ i.name }}</option>}
      </select>
      <select class="a-select" name="fee" [(ngModel)]="fee" (ngModelChange)="load(1)" aria-label="Fee">
        <option value="">Any fee status</option>
        @for (f of feeKeys; track f) {<option [value]="f">{{ feeLabels[f] }}</option>}
      </select>
      <button class="a-btn" type="submit">Search</button>
    </form>

    <div class="a-table-wrap">
      <table class="a-table">
        <thead>
          <tr><th>Application</th><th>Applicant</th><th>Programme</th><th>Mean grade</th><th>Fee</th><th>Status</th><th>Submitted</th></tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td><a [routerLink]="['/admin/applications', r.id]"><strong>{{ r.applicationNumber }}</strong></a></td>
              <td>{{ r.fullName }}<div class="a-small a-muted">{{ r.phone }}</div></td>
              <td>{{ r.programme }}<div class="a-small a-muted">{{ r.intake }}</div></td>
              <td>
                {{ r.meanGrade ?? '—' }}
                @if (r.meetsMinimumGrade === false) {<span class="a-badge a-badge--review" title="Below the programme's minimum grade">Below min.</span>}
              </td>
              <td><span class="a-badge" [class.a-badge--live]="r.feeStatus === 'verified'" [class.a-badge--review]="r.feeStatus === 'claimed'">{{ feeLabels[r.feeStatus] }}</span></td>
              <td><span class="status" [class]="'status status--' + r.status">{{ statusLabels[r.status] }}</span></td>
              <td class="a-small">{{ r.submittedAt | date: 'd MMM y, HH:mm' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="a-empty">No applications match.</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pages() > 1) {
      <div class="a-toolbar pager">
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() <= 1" (click)="load(page() - 1)">Previous</button>
        <span class="a-muted">Page {{ page() }} of {{ pages() }} · {{ total() }} applications</span>
        <button class="a-btn a-btn--sm" type="button" [disabled]="page() >= pages()" (click)="load(page() + 1)">Next</button>
      </div>
    }
  `,
  styleUrl: './applications.scss',
})
export class ApplicationsList {
  private readonly api = inject(AdmissionsAdminApi);
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly feeLabels = FEE_LABELS;
  protected readonly feeKeys = Object.keys(FEE_LABELS);
  protected readonly pipeline = PIPELINE;

  protected readonly rows = signal<ApplicationRow[]>([]);
  protected readonly counts = signal<Record<string, number>>({});
  protected readonly programmes = signal<ProgrammeRow[]>([]);
  protected readonly intakes = signal<IntakeRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly error = signal('');
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / 50)));
  protected readonly totalSubmitted = computed(() => PIPELINE.reduce((n, s) => n + (this.counts()[s] ?? 0), 0));
  private readonly filterVersion = signal(0);
  protected readonly exportUrl = computed(() => {
    this.filterVersion();
    return this.api.exportUrl(this.query());
  });
  /** Same rows and filters, as a printable report on the institution letterhead. */
  protected readonly exportPdfUrl = computed(() => {
    this.filterVersion();
    return this.api.exportUrl(this.query(), 'pdf');
  });

  protected status = '';
  protected search = '';
  protected programmeId = '';
  protected intakeId = '';
  protected fee = '';

  constructor() {
    inject(Title).setTitle('Applications | Admin');
    void this.load(1);
    void this.api.counts().then((c) => this.counts.set(c));
    void this.api.programmes().then((p) => this.programmes.set(p)).catch(() => undefined);
    void this.api.intakes().then((i) => this.intakes.set(i)).catch(() => undefined);
  }

  private query() {
    return { status: this.status, search: this.search.trim(), programmeId: this.programmeId, intakeId: this.intakeId, fee: this.fee };
  }

  setStatus(s: string) {
    this.status = s;
    void this.load(1);
  }

  async load(page: number) {
    this.filterVersion.update((v) => v + 1);
    try {
      const res = await this.api.list({ ...this.query(), page });
      this.rows.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
