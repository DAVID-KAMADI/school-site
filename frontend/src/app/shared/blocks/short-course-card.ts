import { Component, computed, inject, input } from '@angular/core';
import { DELIVERY_LABELS } from '../../core/admissions';
import type { MediaView } from '../../core/models';
import { SiteStore } from '../../core/site';
import { CmsLink, type CmsLinkValue } from '../cms-link';
import { MediaImage } from '../media-image';

export interface PublicShortCourse {
  id: number;
  title: string;
  category: string;
  summary: string;
  duration: string | null;
  fee: string | null;
  delivery: string;
  schedule: string | null;
  nextStartOn: string | null;
  imageId: number | null;
}

/** One short course on the website: photo, what it covers, when and how it runs, the fee and an enquiry button. */
@Component({
  selector: 'app-short-course-card',
  imports: [MediaImage, CmsLink],
  template: `
    <article class="course">
      @if (image(); as img) {
        <div class="course__media">
          <app-media-image [media]="img" sizes="(min-width: 1100px) 380px, (min-width: 700px) 50vw, 100vw" />
          @if (course().category) {
            <span class="course__tag course__tag--over">{{ course().category }}</span>
          }
        </div>
      }
      <div class="course__body">
        @if (!image() && course().category) {
          <span class="course__tag">{{ course().category }}</span>
        }
        <h3 class="course__title">{{ course().title }}</h3>
        @if (course().summary) {
          <p class="course__summary">{{ course().summary }}</p>
        }
        <ul class="course__meta">
          @if (course().duration) {
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              <span class="visually-hidden">{{ site.t('courses.duration', 'Duration') }}: </span>{{ course().duration }}
            </li>
          }
          @if (course().schedule) {
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
              <span class="visually-hidden">{{ site.t('courses.schedule', 'Schedule') }}: </span>{{ course().schedule }}
            </li>
          }
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              @if (course().delivery === 'online') {
                <rect x="3" y="4.5" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16.5V20" />
              } @else {
                <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" />
              }
            </svg>
            {{ deliveryLabel() }}
          </li>
        </ul>
        @if (nextStart()) {
          <p class="course__next">{{ site.t('courses.next_start', 'Next class') }}: <strong>{{ nextStart() }}</strong></p>
        }
        @if (course().fee || enquiryLink()) {
          <div class="course__foot">
            @if (course().fee) {
              <p class="course__fee"><span>{{ site.t('courses.fee', 'Fee') }}</span><strong>{{ course().fee }}</strong></p>
            }
            @if (enquiryLink(); as link) {
              <app-cms-link [link]="link" linkClass="btn btn--outline course__cta" />
            }
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .course {
      height: 100%; display: flex; flex-direction: column; overflow: hidden;
      background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
      transition: box-shadow 0.25s ease, transform 0.25s ease;
    }
    .course:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
    .course__media { position: relative; aspect-ratio: 16 / 9; background: var(--surface-2); overflow: hidden; }
    .course__media app-media-image { height: 100%; }
    .course__body { flex: 1; display: flex; flex-direction: column; gap: 0.65rem; padding: 1.25rem 1.35rem 1.4rem; }
    .course__tag {
      align-self: flex-start; padding: 0.2rem 0.6rem; border-radius: 999px;
      background: var(--surface-3); color: var(--primary); font-size: 0.78rem; font-weight: 650; letter-spacing: 0.02em;
    }
    .course__tag--over { position: absolute; top: 0.85rem; left: 0.85rem; background: rgb(255 255 255 / 0.94); }
    .course__title { margin: 0; font-size: 1.2rem; line-height: 1.3; color: var(--ink); }
    .course__summary { margin: 0; color: var(--muted); }
    .course__meta { list-style: none; margin: 0.15rem 0 0; padding: 0; display: grid; gap: 0.4rem; font-size: 0.95rem; color: var(--text); }
    .course__meta li { display: flex; align-items: center; gap: 0.55rem; }
    .course__meta svg { flex: none; width: 1.1rem; height: 1.1rem; fill: none; stroke: var(--action); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .course__next {
      margin: 0.2rem 0 0; padding: 0.5rem 0.75rem; border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent-text); font-size: 0.92rem;
    }
    .course__foot {
      margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--line);
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    }
    .course__fee { margin: 0; display: grid; line-height: 1.25; }
    .course__fee span { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .course__fee strong { font-size: 1.15rem; color: var(--ink); }
    :host ::ng-deep .course__cta { min-height: 2.5rem; padding-inline: 1.1rem; margin-left: auto; }
  `,
})
export class ShortCourseCard {
  protected readonly site = inject(SiteStore);

  readonly course = input.required<PublicShortCourse>();
  readonly image = input<MediaView | null>(null);
  readonly enquiryLink = input<CmsLinkValue | null>(null);

  protected readonly deliveryLabel = computed(() => {
    const key = this.course().delivery;
    return this.site.t(`courses.delivery.${key}`, DELIVERY_LABELS[key] ?? key);
  });

  /** "3 Nov 2026" in the visitor's language. */
  protected readonly nextStart = computed(() => {
    const iso = this.course().nextStartOn;
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    try {
      return new Intl.DateTimeFormat(this.site.locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
    } catch {
      return iso;
    }
  });
}
