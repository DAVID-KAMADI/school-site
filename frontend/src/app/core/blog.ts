import type { MediaView } from './models';

export interface BlogPostSummary {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: string | null;
  coverImage: MediaView | null;
}

export interface BlogPost extends BlogPostSummary {
  content: string;
}
