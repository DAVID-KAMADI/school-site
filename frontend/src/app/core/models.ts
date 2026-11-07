/** Shapes returned by the Node.js API (see backend/src/cms and backend/src/identity). */

export interface MediaView {
  id: number;
  url: string;
  kind: 'image' | 'document' | 'video';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  credit: string | null;
  hasConsent: boolean;
  focalX: number;
  focalY: number;
  folder: string | null;
  srcset: { url: string; width: number; format: string }[];
  updatedAt: string;
}

export type MediaMap = Record<string, MediaView>;

export interface Block {
  type: string;
  content: Record<string, unknown>;
}

export interface PublicPage {
  /** Language the page is shown in. */
  locale?: string;
  /** False when the visitor's language has no translation yet and the English page is shown. */
  translated?: boolean;
  /** The page's address in each language it is published in. */
  alternates?: { locale: string; path: string }[];
  page: {
    id: number;
    path: string;
    title: string;
    template: 'standard' | 'landing' | 'full_width' | 'side_nav';
    seoTitle: string;
    metaDescription: string | null;
    socialImageId: number | null;
  };
  breadcrumbs: { title: string; path: string }[];
  blocks: Block[];
  media: MediaMap;
  preview?: { revision: number; expiresAt: string };
}

export interface MenuLink {
  label: string;
  href: string;
  openInNewTab: boolean;
  isButton: boolean;
  children: MenuLink[];
}

export interface Language {
  code: string;
  /** Name in the language itself, e.g. "Français". */
  name: string;
  dir: 'ltr' | 'rtl';
}

export interface SiteData {
  locale: string;
  languages: Language[];
  settings: Record<string, unknown>;
  media: MediaMap;
  text: Record<string, string>;
  menus: Record<string, MenuLink[]>;
}

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  scopedPermissions: { permission: string; pageId: number }[];
  twoFactorEnabled: boolean;
}

export interface MeResponse {
  user: AuthUser;
  twoFactorPending: boolean;
  twoFactorSetupRequired: boolean;
}

export interface ApiError {
  message?: string | string[];
  code?: string;
  issues?: { block: number; type: string; path: string; message: string }[];
}
