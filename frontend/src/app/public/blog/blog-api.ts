import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BlogPost, BlogPostSummary } from '../../core/blog';

@Injectable({ providedIn: 'root' })
export class PublicBlogApi {
  private readonly http = inject(HttpClient);

  list(): Promise<BlogPostSummary[]> {
    return firstValueFrom(
      this.http.get<BlogPostSummary[]>('/api/v1/public/blog/posts'),
    );
  }

  post(slug: string): Promise<BlogPost> {
    return firstValueFrom(
      this.http.get<BlogPost>(
        `/api/v1/public/blog/posts/${encodeURIComponent(slug)}`,
      ),
    );
  }
}
