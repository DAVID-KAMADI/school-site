import { DatePipe } from '@angular/common';
import { Component, HostListener, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink, type CanDeactivateFn } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import type { BlogPost } from '../../core/blog';
import { AdminApi } from '../api';
import { RichTextEditor } from '../fields/rich-text-editor';
import { MediaField } from '../fields/media-field';
import { MediaCache } from '../media/media-cache';

export const blogUnsavedChangesGuard: CanDeactivateFn<BlogEditor> = (editor) =>
  editor.canLeave();

@Component({
  selector: 'app-blog-editor',
  imports: [DatePipe, FormsModule, MediaField, RichTextEditor, RouterLink],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div class="a-toolbar">
        <a class="a-btn a-btn--sm" routerLink="/admin/blog">← Blog</a>
        <h1>{{ title || 'Edit blog post' }}</h1>
        @if (post()?.status === 'published') { <span class="a-badge a-badge--live">Published</span> }
        @else if (post()) { <span class="a-badge">Draft</span> }
      </div>
      <div class="a-toolbar">
        @if (post()?.status === 'published') {
          <a class="a-btn" [href]="'/blog/' + post()?.slug" target="_blank" rel="noopener">View post</a>
        }
        @if (auth.can('pages.edit')) {
          <button class="a-btn" type="button" (click)="save()" [disabled]="busy() || !dirty()">Save draft</button>
        }
        @if (post()?.status === 'draft' && auth.can('pages.publish')) {
          <button class="a-btn a-btn--success" type="button" (click)="publish()" [disabled]="busy()">Publish</button>
        }
        @if (post()?.status === 'published' && auth.can('pages.publish')) {
          <button class="a-btn" type="button" (click)="unpublish()" [disabled]="busy()">Unpublish</button>
        }
        @if (auth.can('pages.delete')) {
          <button class="a-btn a-btn--danger" type="button" (click)="remove()" [disabled]="busy()">Delete</button>
        }
      </div>
    </div>

    @if (message()) {
      <div class="a-alert" [class.a-alert--error]="message()?.kind === 'error'" [class.a-alert--success]="message()?.kind === 'success'" role="status">{{ message()?.text }}</div>
    }

    @if (post(); as current) {
      @if (auth.can('pages.edit')) {
        <div class="editor">
          <div class="main-column a-stack">
            <section class="a-panel a-stack">
              <label class="a-field">
                <span>Title</span>
                <input class="a-input title-input" name="title" required maxlength="200" [(ngModel)]="title" (ngModelChange)="touch()" />
              </label>
              <label class="a-field">
                <span>Web address</span>
                <div class="slug-input"><span>/blog/</span><input class="a-input" name="slug" maxlength="180" [(ngModel)]="slug" (ngModelChange)="touch()" /></div>
              </label>
              <label class="a-field">
                <span>Short introduction</span>
                <textarea class="a-textarea" name="excerpt" maxlength="500" rows="3" [(ngModel)]="excerpt" (ngModelChange)="touch()"></textarea>
                <span class="a-help">A short summary shown on the blog page and in search previews.</span>
              </label>
            </section>

            <section class="a-panel content-panel">
              <h2>Article</h2>
              <app-rich-text-editor [(value)]="content" label="Blog article content" (valueChange)="touch()" />
            </section>
          </div>

          <aside class="side-column a-stack">
            <section class="a-panel a-stack">
              <h2>Cover image</h2>
              <app-media-field kind="image" [(value)]="coverImageId" (valueChange)="touch()" />
              <span class="a-help">Choose a photo from the media library to appear on the blog and at the top of the article.</span>
            </section>
            <section class="a-panel a-stack">
              <h2>Publishing</h2>
              <p class="a-small a-muted">
                @if (current.status === 'published') {
                  Published {{ current.publishedAt | date: 'd MMMM y, HH:mm' }}. Changes go live when you save.
                } @else {
                  This post is a draft and is only visible to staff.
                }
              </p>
              @if (dirty()) { <span class="a-badge a-badge--changes">Unsaved changes</span> }
              <button class="a-btn a-btn--primary" type="button" (click)="save()" [disabled]="busy() || !dirty()">Save draft</button>
            </section>
          </aside>
        </div>
      } @else {
        <section class="a-panel">
          <h2>{{ current.title }}</h2>
          <p class="a-muted">You have read-only access to this post. Ask a content editor for permission to make changes.</p>
        </section>
      }
    } @else if (error()) {
      <section class="a-panel"><p>{{ error() }}</p><a class="a-btn" routerLink="/admin/blog">Back to blog</a></section>
    } @else {
      <p class="a-muted">Loading blog post…</p>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; }
    .head h1 { margin: 0; font-size: 1.3rem; }
    .editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(16rem, 21rem); gap: 1rem; align-items: start; }
    .main-column, .side-column { min-width: 0; }
    .title-input { font-size: 1.15rem; font-weight: 650; }
    .slug-input { display: flex; align-items: center; gap: 0.4rem; color: var(--a-muted); }
    .slug-input .a-input { min-width: 0; }
    .content-panel h2 { margin-bottom: 0.85rem; }
    @media (max-width: 900px) { .editor { grid-template-columns: 1fr; } .side-column { grid-row: 1; } }
    @media (max-width: 700px) { .head { align-items: flex-start; } .head > .a-toolbar:last-child { justify-content: flex-end; } }
  `,
})
export class BlogEditor implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  protected readonly auth = inject(AuthStore);
  readonly id = input.required<string>();

  protected readonly post = signal<BlogPost | null>(null);
  protected readonly busy = signal(false);
  protected readonly dirty = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  protected title = '';
  protected slug = '';
  protected excerpt = '';
  protected content = '';
  protected coverImageId: number | null = null;

  ngOnInit() {
    void this.load();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty()) event.preventDefault();
  }

  protected touch() {
    this.dirty.set(true);
    this.message.set(null);
  }

  canLeave() {
    return !this.dirty() || confirm('You have unsaved changes. Leave without saving?');
  }

  private async load() {
    try {
      this.apply(await this.api.blogPost(Number(this.id())));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private apply(post: BlogPost) {
    this.post.set(post);
    this.cache.add(post.coverImage);
    this.title = post.title;
    this.slug = post.slug;
    this.excerpt = post.excerpt;
    this.content = post.content;
    this.coverImageId = post.coverImage?.id ?? null;
    this.dirty.set(false);
    this.titleService.setTitle(`${post.title} | Blog | Admin`);
  }

  private async persist(): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.apply(await this.api.saveBlogPost(Number(this.id()), {
        title: this.title.trim(),
        slug: this.slug.trim(),
        excerpt: this.excerpt.trim(),
        content: this.content,
        coverImageId: this.coverImageId,
      }));
      return true;
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async save() {
    this.message.set(null);
    if (await this.persist())
      this.message.set({ kind: 'success', text: 'Draft saved.' });
  }

  protected async publish() {
    this.message.set(null);
    if (!await this.persist()) return;
    this.busy.set(true);
    try {
      this.apply(await this.api.publishBlogPost(Number(this.id())));
      this.message.set({ kind: 'success', text: 'Post published on the public blog.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async unpublish() {
    this.busy.set(true);
    this.message.set(null);
    try {
      this.apply(await this.api.unpublishBlogPost(Number(this.id())));
      this.message.set({ kind: 'success', text: 'Post returned to drafts.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove() {
    if (!confirm('Delete this blog post? This cannot be undone.')) return;
    this.busy.set(true);
    try {
      await this.api.deleteBlogPost(Number(this.id()));
      this.dirty.set(false);
      await this.router.navigateByUrl('/admin/blog');
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }
}
