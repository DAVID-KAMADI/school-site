import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DOCUMENT, PLATFORM_ID, RESPONSE_INIT, computed, effect, inject, input } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { RedirectCommand, Router, type ResolveFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { PublicPage } from '../core/models';
import { SiteStore } from '../core/site';
import { PageBody } from '../shared/page-body';
import { NotFound } from './not-found';

export type PageResult =
  | { kind: 'page'; data: PublicPage }
  | { kind: 'not_found' }
  | { kind: 'sign_in_required' }
  | { kind: 'error' };

/** Loads the published page for the current address, turning API redirects and 404s into real HTTP responses. */
export const cmsPageResolver: ResolveFn<PageResult | RedirectCommand> = async (_route, state) => {
  const http = inject(HttpClient);
  const router = inject(Router);
  const response = inject(RESPONSE_INIT, { optional: true });
  const server = isPlatformServer(inject(PLATFORM_ID));
  const path = state.url.split(/[?#]/)[0] || '/';

  try {
    const res = await firstValueFrom(
      http.get<PublicPage | { redirect: { to: string; statusCode: number } }>('/api/v1/public/pages', { params: { path } }),
    );
    if ('redirect' in res) {
      const { to, statusCode } = res.redirect;
      if (server && response) {
        response.status = statusCode;
        response.headers = { Location: to };
      }
      if (to.startsWith('/')) return new RedirectCommand(router.parseUrl(to), { replaceUrl: true });
      if (!server) window.location.replace(to);
      return { kind: 'error' };
    }
    return { kind: 'page', data: res };
  } catch (err) {
    const status = err instanceof HttpErrorResponse ? err.status : 500;
    if (response) response.status = status === 404 ? 404 : status === 401 ? 401 : 503;
    if (status === 404) return { kind: 'not_found' };
    if (status === 401) return { kind: 'sign_in_required' };
    return { kind: 'error' };
  }
};

@Component({
  selector: 'app-cms-page',
  imports: [PageBody, NotFound],
  template: `
    @switch (result().kind) {
      @case ('page') {
        @if (page()!.translated === false) {
          <p class="not-translated" role="note">
            <span class="container">{{ site.t('common.not_translated', 'This page is not yet available in {language}, so it is shown in English.', { language: site.language()?.name ?? '' }) }}</span>
          </p>
        }
        <!-- Built afresh for each page instead of reusing the last one, so every page plays its entrance. -->
        @for (p of [page()!.page]; track p.id) {
          <app-page-body
            [attr.lang]="page()!.translated === false ? 'en' : null"
            [attr.dir]="page()!.translated === false ? 'ltr' : null"
            [title]="page()!.page.title"
            [template]="page()!.page.template"
            [breadcrumbs]="page()!.breadcrumbs"
            [blocks]="page()!.blocks"
            [media]="page()!.media"
          />
        }
      }
      @case ('not_found') {
        @if (isHome()) {
          <section class="container container--text status-page">
            <h1>Welcome</h1>
            <p>This website is being set up. Content will appear here once the home page is published.</p>
          </section>
        } @else {
          <app-not-found />
        }
      }
      @case ('sign_in_required') {
        <section class="container container--text status-page">
          <h1>Please sign in</h1>
          <p>This page is only available to signed-in applicants or students.</p>
        </section>
      }
      @default {
        <section class="container container--text status-page">
          <h1>Something went wrong</h1>
          <p>{{ site.t('error.generic', 'Something went wrong. Please try again.') }}</p>
        </section>
      }
    }
  `,
  styles: `
    .status-page { padding-block: var(--section-space); }
    .not-translated { margin: 0; padding-block: 0.7rem; background: var(--surface-3); color: var(--ink); font-size: 0.95rem; }
    .not-translated .container { display: block; }
    app-page-body { display: block; }
  `,
})
export class CmsPage {
  protected readonly site = inject(SiteStore);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  /** Bound from the route resolver. */
  readonly result = input.required<PageResult>();
  protected readonly page = computed(() => {
    const r = this.result();
    return r.kind === 'page' ? r.data : null;
  });
  protected readonly isHome = computed(() => this.site.localize(this.router.url.split(/[?#]/)[0] || '/', 'en') === '/');

  constructor() {
    effect(() => {
      const p = this.page();
      const name = this.site.institutionName();
      const pageTitle = p
        ? p.page.path === '/'
          ? name || p.page.seoTitle
          : `${p.page.seoTitle} | ${name}`
        : this.isHome()
          ? name || 'Welcome'
          : this.site.t('error.not_found_title', 'Page not found');
      this.title.setTitle(pageTitle);
      const description = p?.page.metaDescription || this.site.setting<string>('seo.default_description') || '';
      const imageId = p?.page.socialImageId ?? this.site.setting<number>('seo.default_social_image_media_id');
      const image = (imageId && (p?.media[String(imageId)] ?? this.site.media(imageId))) || null;
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:title', content: pageTitle });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ property: 'og:type', content: 'website' });
      if (image) this.meta.updateTag({ property: 'og:image', content: image.srcset.at(-1)?.url ?? image.url });
      else this.meta.removeTag("property='og:image'");
      this.setAlternates(p?.alternates ?? []);
    });
  }

  /** Tells search engines where this page is in each language (<link rel="alternate" hreflang>). */
  private setAlternates(alternates: { locale: string; path: string }[]) {
    const head = this.document.head;
    head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => l.remove());
    if (alternates.length < 2) return;
    const origin = this.document.location?.origin ?? '';
    for (const a of [...alternates, { locale: 'x-default', path: alternates.find((x) => x.locale === 'en')?.path ?? '/' }]) {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', a.locale);
      link.setAttribute('href', origin + a.path);
      head.appendChild(link);
    }
  }
}
