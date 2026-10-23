import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-url.interceptor';
import { ADMISSIONS_SETUP_PERMISSIONS, AuthStore } from '../../core/auth';
import { FEE_LABELS, STATUS_LABELS } from '../../core/admissions';
import { Icon, type IconName } from '../icon';
import { AUDIT_LABELS } from '../site/audit-log';

interface Summary {
  applications: {
    counts: Record<string, number>;
    feeToConfirm: number;
    submittedThisWeek: number;
    trend: { date: string; count: number }[];
    recent: { id: number; applicationNumber: string; fullName: string; status: string; feeStatus: string; submittedAt: string; programme: string | null }[];
    programmes: { name: string; count: number }[];
    openIntakes: { id: number; name: string; closesAt: string; applications: number }[];
  } | null;
  content: {
    pages: Record<string, number>;
    scheduled: number;
    inReview: { id: number; title: string; updatedAt: string; updatedBy: string | null }[];
    recentlyEdited: { id: number; title: string; status: string; updatedAt: string; updatedBy: string | null }[];
    media: { images: number; documents: number; bytes: number };
  } | null;
  people: { staff: number; without2fa: number; locked: number } | null;
  activity: {
    failedSignIns24h: number;
    recent: { id: number; action: string; entityType: string | null; entityId: string | null; createdAt: string; userName: string | null }[];
  } | null;
}

interface Attention {
  icon: IconName;
  text: string;
  link: string;
  tone: 'warn' | 'info' | 'danger';
}

/** Order and colour of the admissions pipeline bars. */
const PIPELINE: { key: string; color: string }[] = [
  { key: 'submitted', color: '#0345bf' },
  { key: 'under_review', color: '#3d7be0' },
  { key: 'info_requested', color: '#ef6d00' },
  { key: 'offered', color: '#6b4fd8' },
  { key: 'accepted', color: '#12733f' },
  { key: 'declined', color: '#8a94a3' },
  { key: 'rejected', color: '#b42318' },
  { key: 'withdrawn', color: '#b9c1cc' },
];

const PAGE_STATUS: Record<string, string> = { draft: 'Draft', in_review: 'Awaiting approval', published: 'Published', archived: 'Archived' };

const DAY = 86_400_000;

/** Admin home: what needs attention, admissions at a glance, content and recent activity. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, DecimalPipe, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthStore);

  protected readonly data = signal<Summary | null>(null);
  protected readonly error = signal('');
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly feeLabels = FEE_LABELS;
  protected readonly pageStatus = PAGE_STATUS;
  protected readonly today = new Date();

  protected readonly firstName = computed(() => (this.auth.user()?.fullName ?? '').split(/\s+/)[0]);
  protected readonly greeting = computed(() => {
    const h = this.today.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  protected readonly setupPermissions = ADMISSIONS_SETUP_PERMISSIONS;
  protected readonly apps = computed(() => this.data()?.applications ?? null);
  protected readonly content = computed(() => this.data()?.content ?? null);

  /** Applications that have been sent in (everything except drafts). */
  protected readonly submittedTotal = computed(() => {
    const c = this.apps()?.counts ?? {};
    return PIPELINE.reduce((n, s) => n + (c[s.key] ?? 0), 0);
  });
  protected readonly toReview = computed(() => {
    const c = this.apps()?.counts ?? {};
    return (c['submitted'] ?? 0) + (c['under_review'] ?? 0);
  });

  protected readonly pipeline = computed(() => {
    const c = this.apps()?.counts ?? {};
    const max = Math.max(1, ...PIPELINE.map((s) => c[s.key] ?? 0));
    return PIPELINE.map((s) => ({ ...s, label: STATUS_LABELS[s.key], count: c[s.key] ?? 0, pct: ((c[s.key] ?? 0) / max) * 100 }));
  });

  /** Bar chart geometry for the last 30 days (SVG units). */
  protected readonly chart = computed(() => {
    const trend = this.apps()?.trend ?? [];
    const total = trend.reduce((n, d) => n + d.count, 0);
    const peak = Math.max(0, ...trend.map((d) => d.count));
    const max = Math.max(4, Math.ceil(peak / 4) * 4);
    const w = 600;
    const h = 160;
    const slot = w / Math.max(1, trend.length);
    const bars = trend.map((d, i) => {
      const bh = d.count ? Math.max(4, (d.count / max) * h) : 2;
      return {
        x: i * slot + slot * 0.18,
        y: h - bh,
        width: slot * 0.64,
        height: bh,
        empty: !d.count,
        label: `${new Date(d.date + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}: ${d.count} application${d.count === 1 ? '' : 's'}`,
      };
    });
    const grid = [0, 0.5, 1].map((f) => ({ y: h - f * h, value: Math.round(max * f) }));
    const first = trend[0]?.date;
    const mid = trend[Math.floor(trend.length / 2)]?.date;
    return { bars, grid, total, w, h, first, mid };
  });

  protected readonly attention = computed<Attention[]>(() => {
    const d = this.data();
    if (!d) return [];
    const out: Attention[] = [];
    const a = d.applications;
    if (a) {
      const fresh = a.counts['submitted'] ?? 0;
      if (fresh) out.push({ icon: 'inbox', tone: 'info', link: '/admin/applications', text: `${fresh} new application${fresh === 1 ? '' : 's'} waiting to be reviewed` });
      if (a.feeToConfirm)
        out.push({ icon: 'wallet', tone: 'warn', link: '/admin/applications', text: `${a.feeToConfirm} application fee payment${a.feeToConfirm === 1 ? '' : 's'} to confirm` });
      for (const i of a.openIntakes) {
        const days = Math.ceil((new Date(i.closesAt).getTime() - Date.now()) / DAY);
        if (days <= 14) out.push({ icon: 'calendar', tone: 'warn', link: '/admin/admissions-setup', text: `${i.name} intake closes in ${days} day${days === 1 ? '' : 's'}` });
      }
    }
    const review = d.content?.pages['in_review'] ?? 0;
    if (review && this.auth.can('pages.publish'))
      out.push({ icon: 'pages', tone: 'info', link: '/admin/pages', text: `${review} page${review === 1 ? '' : 's'} waiting for your approval` });
    if (d.people?.locked) out.push({ icon: 'alert', tone: 'danger', link: '/admin/users', text: `${d.people.locked} staff account${d.people.locked === 1 ? ' is' : 's are'} locked after failed sign-ins` });
    if (d.people?.without2fa)
      out.push({ icon: 'shield', tone: 'warn', link: '/admin/users', text: `${d.people.without2fa} staff member${d.people.without2fa === 1 ? ' has' : 's have'} not set up two-step login yet` });
    if (d.activity?.failedSignIns24h)
      out.push({ icon: 'alert', tone: 'danger', link: '/admin/audit', text: `${d.activity.failedSignIns24h} failed sign-in attempt${d.activity.failedSignIns24h === 1 ? '' : 's'} in the last 24 hours` });
    return out;
  });

  constructor() {
    inject(Title).setTitle('Dashboard | Admin');
    void this.load();
  }

  async load() {
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.http.get<Summary>('/api/v1/admin/dashboard')));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected activityLabel(action: string): string {
    return AUDIT_LABELS[action] ?? action;
  }

  protected daysLeft(iso: string): number {
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY));
  }

  protected ago(iso: string): string {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86_400);
    return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected size(bytes: number): string {
    return bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : `${Math.round(bytes / 1_048_576)} MB`;
  }

  protected shortDate(date: string | undefined): string {
    return date ? new Date(date + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '';
  }
}
