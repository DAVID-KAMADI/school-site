import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type AlbumRow, type PageIntroEdit } from '../api';
import { PageIntroEditor } from '../fields/page-intro-editor';
import { toastChannel } from '../toast';

/** Admin → Gallery: the photo albums shown on the website's Gallery page (/gallery). */
@Component({
  selector: 'app-gallery-list',
  imports: [RouterLink, DatePipe, PageIntroEditor],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Gallery</h1>
        <p class="a-muted">
          Photo albums of the institute: events, graduations, campus, labs and field work. They show
          on the
          <a href="/gallery" target="_blank" rel="noopener">Gallery page</a>, newest and featured
          first. Visitors can filter albums by category.
        </p>
      </div>
      <a class="a-btn a-btn--primary" routerLink="/admin/gallery/new">+ New album</a>
    </div>

    @if (page(); as p) {
      <app-page-intro-editor [value]="p" [saver]="savePage" viewUrl="/gallery" />
    }

    @if (loaded()) {
      @if (albums().length) {
        <ul class="albums">
          @for (a of albums(); track a.id) {
            <li class="album a-panel">
              <a
                class="album__cover"
                [routerLink]="['/admin/gallery', a.id]"
                [attr.aria-label]="'Edit ' + a.title"
              >
                @if (a.cover) {
                  <img
                    [src]="a.cover.srcset[1]?.url ?? a.cover.srcset[0]?.url ?? a.cover.url"
                    alt=""
                    loading="lazy"
                  />
                } @else {
                  <span class="album__none">No photos yet</span>
                }
                <span class="album__badges">
                  @if (a.isFeatured) {
                    <span class="a-badge feat">Featured</span>
                  }
                  @if (a.isPublished) {
                    <span class="a-badge a-badge--live">On the website</span>
                  } @else {
                    <span class="a-badge">Hidden</span>
                  }
                </span>
              </a>
              <div class="album__body">
                <strong>{{ a.title }}</strong>
                <span class="a-small a-muted">
                  {{ a.photoCount }} {{ a.photoCount === 1 ? 'photo' : 'photos' }}
                  @if (a.category) {
                    · {{ a.category }}
                  }
                  @if (a.takenOn) {
                    · {{ a.takenOn | date: 'd MMM y' }}
                  }
                </span>
                <div class="a-toolbar">
                  <a class="a-btn a-btn--sm" [routerLink]="['/admin/gallery', a.id]">Edit</a>
                  @if (a.isPublished && a.photoCount) {
                    <a
                      class="a-btn a-btn--sm"
                      [href]="'/gallery/' + a.slug"
                      target="_blank"
                      rel="noopener"
                      >View</a
                    >
                  }
                </div>
              </div>
            </li>
          }
        </ul>
      } @else {
        <div class="a-panel a-empty">
          <p>
            No albums yet. Create one and upload photos from an event, the campus or a field trip.
          </p>
          <a class="a-btn a-btn--primary" routerLink="/admin/gallery/new">+ New album</a>
        </div>
      }
    }
  `,
  styles: `
    .head {
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .head p {
      max-width: 60rem;
    }
    .albums {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
    .album {
      display: flex;
      flex-direction: column;
      padding: 0;
      overflow: hidden;
    }
    .album + .album {
      margin-top: 0;
    }
    .album__cover {
      position: relative;
      display: block;
      aspect-ratio: 16 / 10;
      background: #eef1f6;
    }
    .album__cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .album__none {
      display: grid;
      place-items: center;
      height: 100%;
      color: var(--a-muted);
      font-size: 0.9rem;
    }
    .album__badges {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      display: flex;
      gap: 0.3rem;
    }
    .album__badges .a-badge {
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
      background: #fff;
    }
    .album__badges .a-badge--live {
      background: #e3f6ea;
    }
    .feat {
      background: var(--a-accent, #ef6d00) !important;
      color: #fff;
    }
    .album__body {
      display: grid;
      gap: 0.35rem;
      padding: 0.9rem 1rem 1rem;
    }
  `,
})
export class GalleryList {
  private readonly api = inject(AdminApi);
  protected readonly message = toastChannel();
  protected readonly albums = signal<AlbumRow[]>([]);
  protected readonly page = signal<PageIntroEdit | null>(null);
  protected readonly loaded = signal(false);

  protected readonly savePage = async (v: PageIntroEdit) =>
    this.page.set(await this.api.saveGalleryPage(v));

  constructor() {
    inject(Title).setTitle('Gallery | Admin');
    void this.load();
  }

  private async load() {
    try {
      const r = await this.api.galleryAlbums();
      this.albums.set(r.albums);
      this.page.set(r.page);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.loaded.set(true);
    }
  }
}
