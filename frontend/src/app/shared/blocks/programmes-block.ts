import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEVEL_LABELS, STUDY_MODE_LABELS } from '../../core/admissions';
import type { MediaMap } from '../../core/models';
import { SiteStore } from '../../core/site';
import type { CmsLinkValue } from '../cms-link';
import { ShortCourseCard, type PublicShortCourse } from './short-course-card';

export interface PublicProgramme {
  id: number;
  code: string;
  name: string;
  level: string;
  school: string;
  duration: string | null;
  studyModes: string[];
  minMeanGrade: string | null;
  description: string | null;
}

interface Tab {
  key: string;
  label: string;
  programmes: PublicProgramme[];
}

const LEVEL_ORDER = ['certificate', 'diploma', 'degree', 'postgraduate', 'short_course'];
let nextId = 0;

/**
 * The programmes from Admissions setup in tabs by level (Certificate, Diploma, Degree…), plus the
 * short courses in their own tab. Tabs follow the WAI-ARIA pattern: arrow keys move between them.
 */
@Component({
  selector: 'app-programmes-block',
  imports: [RouterLink, ShortCourseCard],
  template: `
    @if (tabs().length) {
      <div class="pt__tabs" role="tablist" [attr.aria-label]="site.t('programmes.levels', 'Programme levels')" (keydown)="onKey($event)">
        @for (tab of tabs(); track tab.key; let i = $index) {
          <button
            type="button"
            role="tab"
            class="pt__tab"
            [id]="id + '-tab-' + i"
            [attr.aria-selected]="selected() === i"
            [attr.aria-controls]="id + '-panel-' + i"
            [attr.tabindex]="selected() === i ? 0 : -1"
            (click)="selected.set(i)"
          >
            {{ tab.label }} <span class="pt__count">{{ tab.key === 'short_courses' ? shortCourses().length : tab.programmes.length }}</span>
          </button>
        }
      </div>

      @for (tab of tabs(); track tab.key; let i = $index) {
        <div class="pt__panel" role="tabpanel" [id]="id + '-panel-' + i" [attr.aria-labelledby]="id + '-tab-' + i" [hidden]="selected() !== i">
          @if (tab.key === 'short_courses') {
            <ul class="pt__grid">
              @for (c of shortCourses(); track c.id) {
                <li><app-short-course-card [course]="c" [image]="m(c.imageId)" [enquiryLink]="enquiryLink()" /></li>
              }
            </ul>
          } @else {
            @if (summary(tab); as s) {
              <p class="pt__summary">{{ s }}</p>
            }
            <ul class="pt__grid">
              @for (p of tab.programmes; track p.id) {
                <li class="prog">
                  <p class="prog__school">{{ p.school }}</p>
                  <h3 class="prog__name">{{ p.name }}</h3>
                  @if (p.description) {
                    <p class="prog__desc">{{ p.description }}</p>
                  }
                  <dl class="prog__facts">
                    @if (p.duration) {
                      <div><dt>{{ site.t('programmes.duration', 'Duration') }}</dt><dd>{{ p.duration }}</dd></div>
                    }
                    @if (p.minMeanGrade) {
                      <div><dt>{{ site.t('programmes.min_entry', 'Minimum entry') }}</dt><dd>KCSE {{ p.minMeanGrade }}</dd></div>
                    }
                    <div class="prog__wide"><dt>{{ site.t('programmes.study_modes', 'Study modes') }}</dt><dd>{{ modes(p) }}</dd></div>
                  </dl>
                  <a class="prog__apply" routerLink="/apply" [attr.aria-label]="site.t('programmes.apply', 'Apply now') + ': ' + p.name">
                    {{ site.t('programmes.apply', 'Apply now') }} <span class="prog__arrow" aria-hidden="true">→</span>
                  </a>
                </li>
              }
            </ul>
          }
        </div>
      }
    } @else {
      <p class="pt__empty">{{ site.t('programmes.none', 'Programmes will be listed here soon.') }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .pt__tabs {
      display: flex; gap: 0.4rem; padding: 0.35rem; margin-bottom: 1.75rem; width: fit-content; max-width: 100%;
      overflow-x: auto; scrollbar-width: none; background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px;
    }
    .pt__tab {
      display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.15rem; border: 0; border-radius: 999px;
      background: transparent; color: var(--text); font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .pt__tab:hover { background: var(--surface-3); color: var(--primary); }
    .pt__tab[aria-selected='true'] { background: var(--primary); color: #fff; box-shadow: 0 2px 8px rgb(0 38 128 / 0.25); }
    .pt__count {
      min-width: 1.5rem; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.78rem; text-align: center;
      background: var(--surface); color: var(--primary);
    }
    .pt__tab[aria-selected='true'] .pt__count { background: var(--accent); color: var(--on-accent); }
    .pt__summary {
      display: inline-block; margin: 0 0 1.25rem; padding: 0.55rem 0.9rem; border-left: 3px solid var(--accent);
      background: var(--surface-2); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--ink);
    }
    .pt__grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); }
    .pt__empty { color: var(--muted); }

    .prog {
      position: relative; display: flex; flex-direction: column; gap: 0.5rem; padding: 1.4rem 1.4rem 1.25rem;
      background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--action); border-radius: var(--radius);
      transition: box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease;
    }
    .prog:hover { box-shadow: var(--shadow); transform: translateY(-2px); border-top-color: var(--accent); }
    .prog__school { margin: 0; font-size: 0.78rem; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-text); }
    .prog__name { margin: 0; font-size: 1.2rem; line-height: 1.3; color: var(--ink); }
    .prog__desc { margin: 0; color: var(--muted); font-size: 0.97rem; }
    .prog__facts {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 1rem; margin: 0.6rem 0 0; padding-top: 0.9rem; border-top: 1px solid var(--line);
    }
    .prog__facts dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .prog__facts dd { margin: 0.1rem 0 0; font-weight: 600; color: var(--ink); }
    .prog__wide { grid-column: 1 / -1; }
    .prog__apply {
      margin-top: auto; padding-top: 0.9rem; align-self: flex-start; color: var(--action); font-weight: 650; text-decoration: none;
    }
    .prog__apply::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
    .prog__apply:focus-visible { outline: none; }
    .prog:has(.prog__apply:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
    .prog__arrow { display: inline-block; transition: transform 0.25s ease; }
    .prog:hover .prog__arrow { transform: translateX(4px); }
  `,
})
export class ProgrammesBlock {
  protected readonly site = inject(SiteStore);

  readonly programmes = input<PublicProgramme[]>([]);
  readonly shortCourses = input<PublicShortCourse[]>([]);
  readonly enquiryLink = input<CmsLinkValue | null>(null);
  readonly media = input<MediaMap>({});

  protected readonly selected = signal(0);
  protected readonly id = `programmes-${nextId++}`;

  /** One tab per level that has programmes, in the usual order, then Short courses. */
  protected readonly tabs = computed<Tab[]>(() => {
    const byLevel = new Map<string, PublicProgramme[]>();
    for (const p of this.programmes()) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);
    const tabs: Tab[] = [...byLevel.keys()]
      .sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))
      .map((level) => ({ key: level, label: this.site.t(`level.${level}`, LEVEL_LABELS[level] ?? level), programmes: byLevel.get(level)! }));
    if (this.shortCourses().length) tabs.push({ key: 'short_courses', label: this.site.t('courses.tab', 'Short courses'), programmes: [] });
    return tabs;
  });

  /** "1 year · Minimum entry: KCSE D" when every programme in the tab shares it. */
  protected summary(tab: Tab): string {
    const same = (values: (string | null)[]) => (values.every((v) => v && v === values[0]) ? values[0] : null);
    const duration = same(tab.programmes.map((p) => p.duration));
    const grade = same(tab.programmes.map((p) => p.minMeanGrade));
    return [
      duration && `${this.site.t('programmes.duration', 'Duration')}: ${duration}`,
      grade && `${this.site.t('programmes.min_entry', 'Minimum entry')}: KCSE ${grade}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected modes(p: PublicProgramme): string {
    return p.studyModes.map((m) => this.site.t(`study_mode.${m}`, STUDY_MODE_LABELS[m] ?? m)).join(', ');
  }

  protected m(id: number | null) {
    return id === null ? null : (this.media()[String(id)] ?? null);
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.tabs().length;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    this.selected.update((i) => (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]')[this.selected()]?.focus();
  }
}
