import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteStore } from '../core/site';

export interface CmsLinkValue {
  label: string;
  href: string;
  openInNewTab?: boolean;
}

/** A link edited in the CMS: site paths use the router (in the visitor's language), everything else is a normal link. */
@Component({
  selector: 'app-cms-link',
  imports: [RouterLink],
  template: `
    @if (internal()) {
      <a [routerLink]="path()" [fragment]="fragment()" [class]="linkClass()">{{ label() }}<ng-content /></a>
    } @else {
      <a
        [href]="href()"
        [class]="linkClass()"
        [attr.target]="link().openInNewTab ? '_blank' : null"
        [attr.rel]="link().openInNewTab ? 'noopener noreferrer' : null"
        >{{ label() }}<ng-content />
        @if (link().openInNewTab) {
          <span class="visually-hidden"> (opens in a new tab)</span>
        }
      </a>
    }
  `,
  styles: `:host { display: contents; }`,
})
export class CmsLink {
  private readonly site = inject(SiteStore);
  readonly link = input.required<CmsLinkValue>();
  readonly linkClass = input('');
  /** Overrides the visible text (e.g. when the label is rendered by projected content). */
  readonly text = input<string | null>(null);

  protected readonly label = computed(() => this.text() ?? this.link().label);
  /** "/admissions" becomes "/fr/admissions" while the visitor reads the site in French. */
  protected readonly href = computed(() => this.site.localize(this.link().href));
  protected readonly internal = computed(() => this.href().startsWith('/') && !this.link().openInNewTab);
  protected readonly path = computed(() => this.href().split('#')[0] || '/');
  protected readonly fragment = computed(() => this.href().split('#')[1] || undefined);
}
