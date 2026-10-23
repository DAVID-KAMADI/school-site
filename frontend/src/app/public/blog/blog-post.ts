import { DatePipe } from '@angular/common';
import { Component, effect, inject, input } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { BlogPost } from '../../core/blog';
import { MediaImage } from '../../shared/media-image';
import { SiteStore } from '../../core/site';

@Component({
  selector: 'app-blog-post',
  imports: [DatePipe, RouterLink, MediaImage],
  template: `
    @if (post(); as article) {
      <article class="article">
        @if (article.coverImage) {
          <div class="article__cover">
            <app-media-image [media]="article.coverImage" sizes="100vw" [eager]="true" />
          </div>
        }
        <div class="container container--text">
          <a class="back" routerLink="/blog">← All stories</a>
          <header class="article__header">
            <p class="meta">
              <time [attr.datetime]="article.publishedAt">{{ article.publishedAt | date: 'd MMMM y' }}</time>
              @if (article.author) { <span> · {{ article.author }}</span> }
            </p>
            <h1>{{ article.title }}</h1>
            @if (article.excerpt) { <p class="excerpt">{{ article.excerpt }}</p> }
          </header>
          <div class="prose article__content" [innerHTML]="article.content"></div>
          <footer class="article__footer"><a class="btn btn--outline" routerLink="/blog">Back to all stories</a></footer>
        </div>
      </article>
    } @else {
      <section class="container container--text missing">
        <h1>Story not found</h1>
        <p>This story may have been moved or is no longer available.</p>
        <a class="btn btn--primary" routerLink="/blog">Browse the blog</a>
      </section>
    }
  `,
  styles: `
    .article { padding-bottom: var(--section-space); }
    .article__cover { height: clamp(15rem, 42vw, 34rem); overflow: hidden; background: var(--surface-2); }
    .article__cover app-media-image { height: 100%; }
    .article__cover ::ng-deep img { object-position: center 40%; }
    .article > .container { padding-top: 2rem; }
    .back { display: inline-flex; margin-bottom: 2.25rem; font-weight: 650; text-decoration: none; }
    .article__header { padding-bottom: 1.5rem; border-bottom: 1px solid var(--line); margin-bottom: 2rem; }
    .article__header h1 { max-width: 22ch; margin-bottom: 0.8rem; }
    .meta { margin-bottom: 0.85rem; color: var(--muted); font-size: 0.92rem; }
    .excerpt { margin: 0; color: var(--muted); font-size: 1.2rem; line-height: 1.55; }
    .article__content { font-size: 1.08rem; line-height: 1.8; overflow-wrap: anywhere; }
    .article__content :first-child { margin-top: 0; }
    .article__footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
    .missing { padding-block: var(--section-space); }
    @media (max-width: 640px) { .article__cover { height: 15rem; } .article__header h1 { font-size: 2.25rem; } }
  `,
})
export class BlogPostPage {
  readonly post = input.required<BlogPost | null>();

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    const site = inject(SiteStore);
    effect(() => {
      const article = this.post();
      const fullTitle = article
        ? `${article.title} | ${site.institutionName()}`
        : `Story not found | ${site.institutionName()}`;
      title.setTitle(fullTitle);
      meta.updateTag({
        name: 'description',
        content: article?.excerpt || article?.title || '',
      });
      meta.updateTag({ property: 'og:title', content: fullTitle });
      meta.updateTag({
        property: 'og:description',
        content: article?.excerpt || '',
      });
      meta.updateTag({ property: 'og:type', content: 'article' });
      if (article?.coverImage)
        meta.updateTag({ property: 'og:image', content: article.coverImage.url });
      else meta.removeTag("property='og:image'");
    });
  }
}
