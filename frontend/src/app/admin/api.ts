import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BlogPost, BlogPostSummary } from '../core/blog';
import type { MediaMap, MediaView } from '../core/models';

export interface PageSummary {
  id: number;
  title: string;
  path: string;
  parentId: number | null;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  visibility: 'public' | 'applicants' | 'students';
  isLive: boolean;
  hasUnpublishedChanges: boolean;
  publishAt: string | null;
  unpublishAt: string | null;
  updatedAt: string;
  canEdit: boolean;
}

export interface EditorBlock {
  id?: number;
  type: string;
  isHidden: boolean;
  content: Record<string, unknown>;
}

export interface PageDetail {
  id: number;
  title: string;
  slug: string;
  path: string;
  parentId: number | null;
  template: 'standard' | 'landing' | 'full_width' | 'side_nav';
  status: PageSummary['status'];
  visibility: PageSummary['visibility'];
  seoTitle: string | null;
  metaDescription: string | null;
  socialImageId: number | null;
  publishAt: string | null;
  unpublishAt: string | null;
  isHome: boolean;
  isLive: boolean;
  latestRevision: number;
  publishedRevision: number | null;
  hasUnpublishedChanges: boolean;
  lockedBy: { id: number; name: string; since: string } | null;
  blocks: EditorBlock[];
  media: Record<string, MediaView>;
  canPublish: boolean;
  canDelete: boolean;
  updatedAt: string;
}

export interface Revision {
  id: number;
  revisionNumber: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  isPublished: boolean;
  blockCount: number;
}

export interface MenuItemEdit {
  id?: number;
  label: string;
  /** Label in other languages, e.g. { fr: "Admissions" }. */
  translations?: Record<string, string>;
  pageId: number | null;
  pagePath?: string | null;
  url: string | null;
  openInNewTab: boolean;
  isButton: boolean;
  isVisible: boolean;
  children: MenuItemEdit[];
}

export interface LanguageRow {
  code: string;
  name: string;
  dir?: 'ltr' | 'rtl';
}

export interface LanguagesInfo {
  languages: LanguageRow[];
  translatableSettings: { key: string; description: string | null; english: string }[];
  /** { fr: { "institution.tagline": "…" } } */
  settingTranslations: Record<string, Record<string, string>>;
}

/** A page's translation into one language (a draft copied from English until first saved). */
export interface TranslationDetail {
  locale: string;
  name: string;
  exists: boolean;
  isLive: boolean;
  hasUnpublishedChanges: boolean;
  /** The English page was saved again after this translation. */
  englishChanged: boolean;
  updatedAt: string | null;
  publishedAt: string | null;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  blocks: Omit<EditorBlock, 'id'>[];
  path: string;
  media: MediaMap;
  canPublish: boolean;
}

export type TranslationSummary = Pick<TranslationDetail, 'locale' | 'name' | 'exists' | 'isLive' | 'hasUnpublishedChanges' | 'englishChanged' | 'updatedAt' | 'publishedAt'>;

export interface SettingRow {
  key: string;
  value: unknown;
  groupName: string;
  description: string | null;
  updatedAt: string;
}

export interface TextRow {
  id: number;
  key: string;
  locale: string;
  value: string;
  description: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  status: 'pending' | 'active' | 'disabled';
  twoFactorEnabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  roles: { roleKey: string; roleName: string; scopePageId: number | null }[];
}

/** Thin, typed wrapper over the admin API. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin';

  private get<T>(url: string, params?: Record<string, string | number>) {
    return firstValueFrom(this.http.get<T>(this.base + url, { params }));
  }
  private post<T>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(this.base + url, body));
  }
  private put<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(this.base + url, body));
  }
  private patch<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(this.base + url, body));
  }
  private delete<T>(url: string) {
    return firstValueFrom(this.http.delete<T>(this.base + url));
  }

  // Pages
  pages = () => this.get<PageSummary[]>('/pages');
  page = (id: number) => this.get<PageDetail>(`/pages/${id}`);
  createPage = (body: { title: string; parentId?: number | null; template?: string }) => this.post<PageDetail>('/pages', body);
  saveContent = (id: number, body: unknown) => this.put<PageDetail>(`/pages/${id}/content`, body);
  pageSettings = (id: number, body: unknown) => this.patch<PageDetail>(`/pages/${id}/settings`, body);
  submit = (id: number) => this.post<PageDetail>(`/pages/${id}/submit`);
  publish = (id: number) => this.post<{ warnings: string[]; page: PageDetail }>(`/pages/${id}/publish`);
  unpublish = (id: number) => this.post<PageDetail>(`/pages/${id}/unpublish`);
  revisions = (id: number) => this.get<Revision[]>(`/pages/${id}/revisions`);
  restoreRevision = (id: number, revisionId: number) => this.post<PageDetail>(`/pages/${id}/revisions/${revisionId}/restore`);
  duplicate = (id: number) => this.post<PageDetail>(`/pages/${id}/duplicate`);
  lock = (id: number) => this.post<{ locked: boolean; lockedBy: PageDetail['lockedBy'] }>(`/pages/${id}/lock`);
  unlock = (id: number) => this.delete(`/pages/${id}/lock`);
  previewLink = (id: number) => this.post<{ url: string; expiresAt: string }>(`/pages/${id}/preview-link`, { hours: 48 });
  trashPage = (id: number) => this.delete(`/pages/${id}`);
  trash = () => this.get<{ id: number; title: string; path: string; deletedAt: string; purgeAfter: string }[]>('/pages/trash');
  restorePage = (id: number) => this.post<PageDetail>(`/pages/${id}/restore`);
  translations = (id: number) => this.get<TranslationSummary[]>(`/pages/${id}/translations`);
  translation = (id: number, locale: string) => this.get<TranslationDetail>(`/pages/${id}/translations/${locale}`);
  saveTranslation = (id: number, locale: string, body: unknown) => this.put<TranslationDetail>(`/pages/${id}/translations/${locale}`, body);
  publishTranslation = (id: number, locale: string) =>
    this.post<{ warnings: string[]; translation: TranslationDetail }>(`/pages/${id}/translations/${locale}/publish`);
  unpublishTranslation = (id: number, locale: string) => this.post<TranslationDetail>(`/pages/${id}/translations/${locale}/unpublish`);
  deleteTranslation = (id: number, locale: string) => this.delete(`/pages/${id}/translations/${locale}`);

  // Blog
  blogPosts = () => this.get<BlogPostSummary[]>('/blog');
  blogPost = (id: number) => this.get<BlogPost>(`/blog/${id}`);
  createBlogPost = (body: { title: string }) => this.post<BlogPost>('/blog', body);
  saveBlogPost = (id: number, body: { title: string; slug: string; excerpt: string; content: string; coverImageId: number | null }) =>
    this.put<BlogPost>(`/blog/${id}`, body);
  publishBlogPost = (id: number) => this.post<BlogPost>(`/blog/${id}/publish`);
  unpublishBlogPost = (id: number) => this.post<BlogPost>(`/blog/${id}/unpublish`);
  deleteBlogPost = (id: number) => this.delete(`/blog/${id}`);

  // Media
  media = (q: { search?: string; folder?: string; kind?: string; page?: number }) =>
    this.get<{ items: MediaView[]; total: number; page: number; pageSize: number }>(
      '/media',
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>,
    );
  mediaItem = (id: number) => this.get<MediaView & { usages: { entityType: string; entityId: string; fieldPath: string }[] }>(`/media/${id}`);
  folders = () => this.get<string[]>('/media/folders');
  upload(file: File, fields: { altText?: string; folder?: string } = {}) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    return this.post<MediaView>('/media', form);
  }
  replaceMedia(id: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.post<MediaView>(`/media/${id}/replace`, form);
  }
  updateMedia = (id: number, body: Partial<MediaView>) => this.patch<MediaView>(`/media/${id}`, body);
  deleteMedia = (id: number, force = false) => this.delete(`/media/${id}${force ? '?force=true' : ''}`);

  // Site
  menus = () => this.get<{ location: string; name: string; items: MenuItemEdit[] }[]>('/menus');
  saveMenu = (location: string, items: unknown) => this.put(`/menus/${location}`, { items });
  settings = () => this.get<SettingRow[]>('/settings');
  languages = () => this.get<LanguagesInfo>('/languages');
  saveLanguages = (languages: LanguageRow[]) => this.put<LanguageRow[]>('/languages', { languages });
  saveSettingTranslations = (locale: string, values: Record<string, string>) =>
    this.put<Record<string, string>>(`/languages/${locale}/settings`, { values });
  saveSetting = (key: string, value: unknown) => this.put<SettingRow>(`/settings/${encodeURIComponent(key)}`, { value });
  texts = () => this.get<TextRow[]>('/text-strings');
  saveText = (key: string, locale: string, value: string) => this.put<TextRow>(`/text-strings/${encodeURIComponent(key)}`, { locale, value });
  redirects = () => this.get<{ id: number; fromPath: string; toPath: string; statusCode: number; hitCount: number }[]>('/redirects');
  saveRedirect = (body: { fromPath: string; toPath: string; statusCode: number }) => this.post('/redirects', body);
  deleteRedirect = (id: number) => this.delete(`/redirects/${id}`);

  // Users
  users = () => this.get<UserRow[]>('/users');
  roles = () => this.get<{ key: string; name: string; description: string | null; permissions: string[] }[]>('/users/roles');
  createUser = (body: { email: string; fullName: string; phone?: string }) => this.post<{ id: number; temporaryPassword?: string }>('/users', body);
  updateUser = (id: number, body: Partial<UserRow>) => this.patch(`/users/${id}`, body);
  setRoles = (id: number, roles: { roleKey: string; scopePageId: number | null }[]) => this.put(`/users/${id}/roles`, { roles });
  resetTwoFactor = (id: number) => this.post(`/users/${id}/reset-2fa`);
  resetPassword = (id: number) => this.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`);

  // Access control
  accessMatrix = () => this.get<AccessMatrix>('/access/matrix');
  accessReview = () => this.get<AccessReviewRow[]>('/access/review');
  setRolePermissions = (key: string, permissions: string[]) =>
    this.put<{ role: string; added: string[]; removed: string[] }>(`/access/roles/${key}/permissions`, { permissions });
  createRole = (body: { name: string; description?: string | null; copyFrom?: string | null }) => this.post<{ key: string; name: string }>('/access/roles', body);
  updateRole = (key: string, body: { name?: string; description?: string | null }) => this.patch(`/access/roles/${key}`, body);
  deleteRole = (key: string) => this.delete(`/access/roles/${key}`);

  // Applicant accounts
  applicants = (q: { search?: string; page?: number }) =>
    this.get<{ items: ApplicantRow[]; total: number; page: number; pageSize: number }>('/applicants', { search: q.search ?? '', page: q.page ?? 1 });
  setApplicantStatus = (id: number, status: 'active' | 'disabled') => this.patch(`/applicants/${id}/status`, { status });
  resetApplicantPassword = (id: number) => this.post<{ temporaryPassword: string }>(`/applicants/${id}/reset-password`);
}

export interface AccessMatrix {
  permissions: { key: string; description: string; module: string }[];
  roles: { key: string; name: string; description: string | null; locked: boolean; people: number; permissions: string[] }[];
}

export interface AccessReviewRow {
  id: number;
  fullName: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  roles: { name: string; section: string | null }[];
  modules: string[];
}

export interface ApplicantRow {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  status: 'pending' | 'active' | 'disabled';
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  application: { id: number; applicationNumber: string | null; status: string; programme: string | null } | null;
}
