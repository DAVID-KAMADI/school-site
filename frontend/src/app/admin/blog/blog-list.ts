import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import type { BlogPostSummary } from '../../core/blog';
import { AdminApi } from '../api';

@Component({
  selector: 'app-blog-list',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Blog</h1>
        <p class="a-muted">Write stories and updates for the public website.</p>
      </div>
      @if (auth.can('pages.create')) {
        <button class="a-btn a-btn--primary" type="button" (click)="creating.set(true)">+ New post</button>
      }
    </div>
    @if (error()) { <div class="a-alert a-alert--error" role="alert">{{ error() }}</div> }

    <div class="a-table-wrap">
      <table class="a-table">
        <thead><tr><th>Post</th><th>Status</th><th>Last changed</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          @for (post of posts(); track post.id) {
            <tr>
              <td>
                <div class="post-cell">
                  @if (post.coverImage) { <img [src]="post.coverImage.srcset[0]?.url ?? post.coverImage.url" [alt]="post.coverImage.altText ?? ''" /> }
                  <div>
                    <a class="post-title" [routerLink]="['/admin/blog', post.id]">{{ post.title }}</a>
                    <span class="a-small a-muted">/blog/{{ post.slug }}</span>
                  </div>
                </div>
              </td>
              <td>
                @if (post.status === 'published') {
                  <span class="a-badge a-badge--live">Published</span>
                } @else {
                  <span class="a-badge">Draft</span>
                }
              </td>
              <td class="a-small a-muted">{{ post.updatedAt | date: 'd MMM y, HH:mm' }}</td>
              <td class="actions">
                @if (post.status === 'published') {
                  <a class="a-btn a-btn--sm" [href]="'/blog/' + post.slug" target="_blank" rel="noopener">View</a>
                }
                <a class="a-btn a-btn--sm" [routerLink]="['/admin/blog', post.id]">Edit</a>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="a-empty">No blog posts yet. Create a post to share a story with your community.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (creating()) {
      <div class="a-modal-backdrop" (click)="creating.set(false)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-labelledby="new-post-title" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <h2 id="new-post-title">Start a blog post</h2>
          <label class="a-field">
            <span>Post title</span>
            <input class="a-input" name="title" required maxlength="200" [(ngModel)]="newTitle" autofocus />
            <span class="a-help">You can write and save your post as a draft before publishing.</span>
          </label>
          @if (error()) { <div class="a-alert a-alert--error" role="alert">{{ error() }}</div> }
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="!newTitle.trim() || busy()">Create post</button>
            <button class="a-btn" type="button" (click)="creating.set(false)">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; }
    .head h1 { margin: 0; }
    .head p { margin: 0.35rem 0 0; }
    .post-cell { display: flex; align-items: center; gap: 0.8rem; min-width: 16rem; }
    .post-cell img { width: 3.5rem; height: 2.7rem; border-radius: 6px; object-fit: cover; border: 1px solid var(--a-line); }
    .post-cell > div { display: grid; }
    .post-title { font-weight: 650; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .a-btn { margin-left: 0.3rem; }
  `,
})
export class BlogList {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  protected readonly posts = signal<BlogPostSummary[]>([]);
  protected readonly error = signal('');
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected newTitle = '';

  constructor() {
    inject(Title).setTitle('Blog | Admin');
    void this.load();
  }

  async load() {
    try {
      this.posts.set(await this.api.blogPosts());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async create() {
    this.busy.set(true);
    this.error.set('');
    try {
      const post = await this.api.createBlogPost({ title: this.newTitle.trim() });
      await this.router.navigate(['/admin/blog', post.id]);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
