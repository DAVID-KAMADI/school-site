import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { BlogPostSummary } from '../../core/blog';
import { MediaImage } from '../../shared/media-image';
import type { BlogListResult } from './blog-resolvers';

@Component({
  selector: 'app-blog-list',
  imports: [DatePipe, RouterLink, MediaImage],
  template: `
    <section class="blog container">
      <header class="blog__intro">
        <p class="eyebrow">Stories & updates</p>
        <h1>Our blog</h1>
        <p class="lead">News, ideas and stories from our school community.</p>
      </header>

      @if (result().unavailable) {
        <p class="notice" role="alert">The blog is temporarily unavailable. Please try again shortly.</p>
      } @else if (result().posts.length) {
        <div class="grid">
          @for (post of result().posts; track post.id) {
            <article class="card">
              <a class="card__image" [routerLink]="['/blog', post.slug]" [attr.aria-label]="'Read ' + post.title">
                @if (post.coverImage) {
                  <app-media-image [media]="post.coverImage" sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw" />
                } @else {
                  <span class="card__placeholder" aria-hidden="true">School stories</span>
                }
              </a>
              <div class="card__body">
                <p class="meta">
                  <time [attr.datetime]="post.publishedAt">{{ post.publishedAt | date: 'd MMMM y' }}</time>
                  @if (post.author) { <span>· {{ post.author }}</span> }
                </p>
                <h2><a [routerLink]="['/blog', post.slug]">{{ post.title }}</a></h2>
                @if (post.excerpt) { <p class="excerpt">{{ post.excerpt }}</p> }
                <a class="read-more" [routerLink]="['/blog', post.slug]">Read story <span aria-hidden="true">→</span></a>
              </div>
            </article>
          }
        </div>
      } @else {
        <div class="empty">
          <span class="empty__mark" aria-hidden="true">✦</span>
          <h2>Stories are on their way</h2>
          <p>Check back soon for news and updates from our school community.</p>
        </div>
      }
    </section>
  `,
  styles: `
    .blog { padding-block: clamp(3rem, 7vw, 5.5rem); }
    .blog__intro { max-width: 48rem; margin: 0 auto 3rem; text-align: center; }
    .eyebrow { margin-bottom: 0.65rem; color: var(--accent-text); font-size: 0.82rem; font-weight: 750; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { margin-bottom: 0.75rem; }
    .lead { margin: 0; color: var(--muted); font-size: clamp(1.05rem, 2vw, 1.25rem); }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; }
    .card { overflow: hidden; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); transition: transform 0.18s ease, box-shadow 0.18s ease; }
    .card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgb(0 26 92 / 0.11); }
    .card__image { display: block; overflow: hidden; height: 13rem; background: linear-gradient(135deg, var(--primary), var(--action)); }
    .card__image ::ng-deep img { transition: transform 0.25s ease; }
    .card:hover .card__image ::ng-deep img { transform: scale(1.035); }
    .card__placeholder { display: grid; height: 100%; place-items: center; color: #fff; font-size: 1.1rem; font-weight: 650; }
    .card__body { display: flex; flex: 1; flex-direction: column; align-items: flex-start; padding: 1.35rem 1.4rem 1.5rem; }
    .meta { margin: 0 0 0.7rem; color: var(--muted); font-size: 0.85rem; }
    h2 { margin: 0 0 0.7rem; font-size: 1.35rem; }
    h2 a { color: var(--ink); text-decoration: none; }
    h2 a:hover { color: var(--action); }
    .excerpt { color: var(--muted); margin-bottom: 1.2rem; }
    .read-more { display: inline-flex; gap: 0.45rem; align-items: center; margin-top: auto; font-weight: 700; text-decoration: none; }
    .empty { padding: 4rem 1rem; text-align: center; border: 1px dashed var(--line); border-radius: var(--radius); background: var(--surface-2); }
    .empty__mark { display: inline-grid; place-items: center; width: 3rem; height: 3rem; margin-bottom: 1rem; border-radius: 50%; color: var(--primary); background: var(--surface-3); font-size: 1.5rem; }
    .empty h2 { margin-bottom: 0.5rem; }
    .empty p { margin: 0; color: var(--muted); }
    .notice { padding: 1rem 1.2rem; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; gap: 1rem; } .card__image { height: 12rem; } }
    @media (prefers-reduced-motion: reduce) { .card, .card__image ::ng-deep img { transition: none; } }
  `,
})
export class BlogList {
  readonly result = input.required<BlogListResult>();

  constructor() {
    inject(Title).setTitle('Our blog');
  }
}
