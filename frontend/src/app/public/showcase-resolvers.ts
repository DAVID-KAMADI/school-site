import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, RESPONSE_INIT } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { DownloadsIndex, GalleryAlbumView, GalleryIndex, StaffHierarchy } from '../core/showcase';

/** What a Gallery or Our people page receives: the data, or why it could not be loaded. */
export type Loaded<T> =
  { data: T; error: null } | { data: null; error: 'not-found' | 'unavailable' };

async function load<T>(url: string): Promise<Loaded<T>> {
  const http = inject(HttpClient);
  const response = inject(RESPONSE_INIT, { optional: true });
  try {
    return { data: await firstValueFrom(http.get<T>(url)), error: null };
  } catch (err) {
    const notFound = err instanceof HttpErrorResponse && err.status === 404;
    if (response) response.status = notFound ? 404 : 503;
    return { data: null, error: notFound ? 'not-found' : 'unavailable' };
  }
}

export const galleryResolver: ResolveFn<Loaded<GalleryIndex>> = () =>
  load('/api/v1/public/gallery');

export const albumResolver: ResolveFn<Loaded<GalleryAlbumView>> = (route) =>
  load(`/api/v1/public/gallery/${encodeURIComponent(route.paramMap.get('slug') ?? '')}`);

export const staffResolver: ResolveFn<Loaded<StaffHierarchy>> = () => load('/api/v1/public/staff');

export const downloadsResolver: ResolveFn<Loaded<DownloadsIndex>> = () => load('/api/v1/public/downloads');
