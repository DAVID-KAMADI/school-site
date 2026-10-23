import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import type { ResolveFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { PublicPage } from '../core/models';
import { PageBody } from '../shared/page-body';

export const previewResolver: ResolveFn<PublicPage | null> = (route) =>
  firstValueFrom(inject(HttpClient).get<PublicPage>(`/api/v1/public/preview/${encodeURIComponent(route.paramMap.get('token') ?? '')}`)).catch(
    () => null,
  );

/** Shows an unpublished draft to someone with a preview link. Never indexed by search engines. */
@Component({
  selector: 'app-preview-page',
  imports: [PageBody, DatePipe],
  template: `
    @if (preview(); as p) {
      <div class="preview-bar" role="status">
        Draft preview (revision {{ p.preview?.revision }}). This link expires {{ p.preview?.expiresAt | date: 'medium' }}.
      </div>
      <app-page-body [title]="p.page.title" [template]="p.page.template" [breadcrumbs]="p.breadcrumbs" [blocks]="p.blocks" [media]="p.media" />
    } @else {
      <section class="container container--text" style="padding-block: var(--section-space)">
        <h1>Preview link expired</h1>
        <p>Ask the editor for a new preview link.</p>
      </section>
    }
  `,
  styles: `.preview-bar { background: var(--warning); color: #fff; text-align: center; padding: 0.6rem 1rem; font-weight: 600; }`,
})
export class PreviewPage {
  readonly preview = input<PublicPage | null>(null);

  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }
}
