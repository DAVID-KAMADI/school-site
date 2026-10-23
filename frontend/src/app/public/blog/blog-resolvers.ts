import { HttpErrorResponse } from '@angular/common/http';
import { inject, RESPONSE_INIT } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { BlogPost, BlogPostSummary } from '../../core/blog';
import { PublicBlogApi } from './blog-api';

export interface BlogListResult {
  posts: BlogPostSummary[];
  unavailable: boolean;
}

export const blogListResolver: ResolveFn<BlogListResult> = async () => {
  const response = inject(RESPONSE_INIT, { optional: true });
  try {
    return { posts: await inject(PublicBlogApi).list(), unavailable: false };
  } catch {
    if (response) response.status = 503;
    return { posts: [], unavailable: true };
  }
};

export const blogPostResolver: ResolveFn<BlogPost | null> = async (route) => {
  const blog = inject(PublicBlogApi);
  const response = inject(RESPONSE_INIT, { optional: true });
  try {
    return await blog.post(route.paramMap.get('slug') ?? '');
  } catch (err) {
    const status = err instanceof HttpErrorResponse ? err.status : 500;
    if (response) response.status = status === 404 ? 404 : 503;
    return null;
  }
};
