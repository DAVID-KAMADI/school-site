import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Block, MediaMap } from '../core/models';
import { BlockView } from './blocks/block-view';
import { Reveal } from './motion';

/**
 * A page's title area and blocks. Shared by the public site, preview links and the admin live preview,
 * so editors see exactly what visitors will see.
 */
@Component({
  selector: 'app-page-body',
  imports: [BlockView, RouterLink, Reveal],
  template: `
    @if (showHeader()) {
      <header class="page-header" appReveal>
        <div class="container">
          @if (breadcrumbs().length) {
            <nav aria-label="Breadcrumb">
              <ol class="breadcrumbs">
                @for (c of breadcrumbs(); track c.path) {
                  <li><a [routerLink]="c.path">{{ c.title }}</a></li>
                }
                <li aria-current="page">{{ title() }}</li>
              </ol>
            </nav>
          }
          <h1>{{ title() }}</h1>
        </div>
      </header>
    }
    @for (block of blocks(); track $index; let i = $index) {
      <app-block-view appReveal [block]="block" [media]="media()" [first]="i === 0" />
    }
  `,
  styles: `
    .page-header { background: var(--surface-2); padding-block: clamp(2rem, 5vw, 3.5rem); margin-bottom: calc(var(--section-space) / 2); }
    .page-header h1 { margin: 0; max-width: 24ch; animation: rise-in 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
    .page-header.motion h1 { animation: none; }
    .breadcrumbs { list-style: none; display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; margin: 0 0 0.75rem; padding: 0; font-size: 0.92rem; color: var(--muted); }
    .breadcrumbs li + li::before { content: '/'; margin-right: 0.5rem; color: var(--line); }
  `,
})
export class PageBody {
  readonly title = input('');
  readonly template = input<string>('standard');
  readonly breadcrumbs = input<{ title: string; path: string }[]>([]);
  readonly blocks = input<Block[]>([]);
  readonly media = input<MediaMap>({});

  /** Landing pages and pages that open with a hero supply their own heading. */
  protected readonly showHeader = computed(() => this.template() !== 'landing' && this.blocks()[0]?.type !== 'hero');
}
