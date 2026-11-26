import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AlbumCard } from '../../core/showcase';
import { MediaImage } from '../../shared/media-image';

/**
 * One album on the Gallery page: its cover with two more photos tucked behind it like a stack of prints.
 * On hover the prints behind fan out and the cover leans in.
 */
@Component({
  selector: 'app-album-card',
  imports: [RouterLink, DatePipe, MediaImage],
  template: `
    @let a = album();
    <a class="card" [class.card--featured]="featured()" [routerLink]="['/gallery', a.slug]">
      <span class="card__behind" aria-hidden="true">
        @for (p of a.preview.slice(0, 2); track p.id; let j = $index) {
          <span class="card__sheet" [class.card__sheet--right]="j === 1"
            ><app-media-image [media]="p" [decorative]="true" sizes="20rem"
          /></span>
        }
      </span>
      <span class="card__cover">
        @if (a.cover) {
          <app-media-image
            [media]="a.cover"
            [decorative]="true"
            [sizes]="
              featured()
                ? '(max-width: 700px) 100vw, 66vw'
                : '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw'
            "
          />
        }
        <span class="card__shade" aria-hidden="true"></span>
        <span class="card__text">
          @if (a.category || a.takenOn) {
            <span class="card__meta">
              @if (a.category) {
                <span class="card__tag">{{ a.category }}</span>
              }
              @if (a.takenOn) {
                <time [attr.datetime]="a.takenOn">{{ a.takenOn | date: 'MMM y' }}</time>
              }
            </span>
          }
          <span class="card__title">{{ a.title }}</span>
          @if (featured() && a.description) {
            <span class="card__desc">{{ a.description }}</span>
          }
          <span class="card__count">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h3l2-3h6l2 3h3v13H4z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            {{ a.photoCount }} {{ a.photoCount === 1 ? 'photo' : 'photos' }}
          </span>
        </span>
      </span>
    </a>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .card {
      position: relative;
      display: block;
      height: 100%;
      padding-top: 0.9rem;
      color: #fff;
      text-decoration: none;
      isolation: isolate;
    }
    .card:focus-visible {
      outline: none;
    }
    .card:focus-visible .card__cover {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }

    /* Prints tucked behind the cover, peeking out at the top. */
    .card__behind {
      position: absolute;
      inset: 0.9rem 0 0;
      z-index: -1;
    }
    .card__sheet {
      position: absolute;
      inset: 0 5% 4%;
      overflow: hidden;
      border-radius: var(--radius);
      background: var(--surface-3);
      border: 4px solid #fff;
      box-shadow: var(--shadow);
      transform: translate(-2%, -0.55rem) rotate(-2.2deg);
      transform-origin: 50% 100%;
      transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .card__sheet--right {
      transform: translate(2%, -0.35rem) rotate(2deg);
    }
    .card:hover .card__sheet,
    .card:focus-visible .card__sheet {
      transform: translate(-7%, -1.4rem) rotate(-7deg);
    }
    .card:hover .card__sheet--right,
    .card:focus-visible .card__sheet--right {
      transform: translate(7%, -1.1rem) rotate(6deg);
    }

    .card__cover {
      position: relative;
      display: block;
      overflow: hidden;
      height: 100%;
      min-height: 15rem;
      aspect-ratio: 4 / 3;
      border-radius: var(--radius);
      background: linear-gradient(135deg, var(--primary), var(--action));
      box-shadow: 0 14px 30px -14px color-mix(in srgb, var(--primary-deep) 45%, transparent);
      transition:
        transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
        box-shadow 0.45s ease;
    }
    .card--featured .card__cover {
      aspect-ratio: auto;
      min-height: 22rem;
    }
    .card:hover .card__cover {
      transform: translateY(-4px);
      box-shadow: 0 24px 40px -18px color-mix(in srgb, var(--primary-deep) 55%, transparent);
    }
    .card__cover app-media-image {
      position: absolute;
      inset: 0;
      transition: scale 0.9s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .card:hover .card__cover app-media-image {
      scale: 1.06;
    }
    .card__shade {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, color-mix(in srgb, var(--primary-deep) 0%, transparent) 35%, color-mix(in srgb, var(--primary-deep) 82%, transparent) 100%);
    }

    .card__text {
      position: absolute;
      inset: auto 0 0;
      display: grid;
      gap: 0.3rem;
      padding: 1.2rem 1.3rem 1.25rem;
    }
    .card__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.8rem;
      color: rgb(255 255 255 / 0.85);
    }
    .card__tag {
      padding: 0.12rem 0.6rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .card__title {
      font-size: 1.3rem;
      font-weight: 700;
      line-height: 1.2;
      text-wrap: balance;
    }
    .card--featured .card__title {
      font-size: clamp(1.5rem, 2.6vw, 2.1rem);
    }
    .card__desc {
      max-width: 46ch;
      color: rgb(255 255 255 / 0.88);
      font-size: 0.98rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card__count {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
      font-size: 0.85rem;
      color: rgb(255 255 255 / 0.85);
    }
    .card__count svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linejoin: round;
    }

    @media (prefers-reduced-motion: reduce) {
      .card__sheet,
      .card__cover,
      .card__cover app-media-image {
        transition: none;
      }
    }
  `,
})
export class AlbumCardView {
  readonly album = input.required<AlbumCard>();
  readonly featured = input(false);
}
