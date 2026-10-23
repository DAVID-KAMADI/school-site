import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, afterNextRender, inject, input, signal, type OnDestroy } from '@angular/core';
import type { MediaView } from '../../core/models';
import { MediaImage } from '../media-image';

const INTERVAL_MS = 6500;

/**
 * Background photos for the hero: crossfades with a slow zoom ("Ken Burns").
 * Pauses on hover, keyboard focus or the pause button (WCAG 2.2.2), and stays still for reduced-motion users.
 */
@Component({
  selector: 'app-hero-slideshow',
  imports: [MediaImage],
  host: { '(mouseenter)': 'hover.set(true)', '(mouseleave)': 'hover.set(false)' },
  template: `
    <div class="slides" [class.slides--still]="!animate()">
      @for (s of slides(); track s.id; let i = $index) {
        <div class="slide" [class.slide--active]="i === current()" [attr.aria-hidden]="i !== current()">
          <!-- Only the first photo loads with the page; the rest follow once it has finished, to save mobile data. -->
          @if (i === 0 || loadRest()) {
            <app-media-image [media]="s" sizes="100vw" [eager]="i === 0" [decorative]="true" />
          }
        </div>
      }
    </div>
    @if (slides().length > 1) {
      <div class="controls">
        <button type="button" class="ctl" (click)="toggle()" [attr.aria-label]="paused() ? 'Play slideshow' : 'Pause slideshow'">
          {{ paused() ? '▶' : '❚❚' }}
        </button>
        @for (s of slides(); track s.id; let i = $index) {
          <button type="button" class="dot" [class.dot--active]="i === current()" (click)="go(i)" [attr.aria-label]="'Show photo ' + (i + 1)" [attr.aria-current]="i === current()"></button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; display: block; }
    .slides, .slide { position: absolute; inset: 0; overflow: hidden; }
    .slide { opacity: 0; transition: opacity 1.4s ease; }
    .slide--active { opacity: 1; }
    .slide app-media-image { height: 100%; transform-origin: 60% 40%; }
    .slide--active app-media-image { animation: kenburns 9s ease-out forwards; }
    .slides--still .slide app-media-image { animation: none; }
    @keyframes kenburns { from { transform: scale(1.12); } to { transform: scale(1); } }
    .controls { position: absolute; z-index: 3; right: var(--gutter); bottom: 1.5rem; display: flex; gap: 0.5rem; align-items: center; }
    .ctl { width: 2.25rem; height: 2.25rem; border-radius: 50%; border: 1px solid rgb(255 255 255 / 0.6); background: rgb(0 26 92 / 0.35); color: #fff; font-size: 0.7rem; cursor: pointer; }
    /* 24px tap area (WCAG 2.5.8) around a small visual dot. */
    .dot { position: relative; width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer; transition: width 0.3s ease; }
    .dot::before { content: ''; position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 0.65rem; height: 0.65rem; border-radius: 999px; background: rgb(255 255 255 / 0.55); transition: width 0.3s ease, background 0.3s ease; }
    .dot--active { width: 2.4rem; }
    .dot--active::before { width: 1.9rem; background: var(--accent); }
    .dot:hover::before { background: rgb(255 255 255 / 0.9); }
    .ctl:hover { background-color: rgb(255 255 255 / 0.85); }
    .ctl:hover { color: var(--primary); }
  `,
})
export class HeroSlideshow implements OnDestroy {
  readonly slides = input.required<MediaView[]>();
  protected readonly current = signal(0);
  protected readonly paused = signal(false);
  protected readonly hover = signal(false);
  protected readonly animate = signal(true);
  protected readonly loadRest = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => {
      const later = () => setTimeout(() => this.loadRest.set(true), 2500);
      if (document.readyState === 'complete') later();
      else window.addEventListener('load', later, { once: true });
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.animate.set(false);
        this.paused.set(true);
        return;
      }
      this.timer = setInterval(() => {
        const focused = document.activeElement?.closest('.hero') !== null && document.activeElement !== document.body;
        if (!this.paused() && !this.hover() && !focused && !document.hidden) this.next();
      }, INTERVAL_MS);
    });
  }

  next() {
    if (!this.loadRest()) return;
    this.current.update((i) => (i + 1) % this.slides().length);
  }

  go(i: number) {
    this.loadRest.set(true);
    this.current.set(i);
  }

  toggle() {
    this.paused.update((p) => !p);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
