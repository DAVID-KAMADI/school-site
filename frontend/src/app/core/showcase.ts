import type { MediaMap, MediaView } from './models';

/** The small label, heading and introduction at the top of the Gallery and Our people pages. */
export interface PageIntro {
  eyebrow: string;
  title: string;
  intro: string;
}

export interface AlbumCard {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  takenOn: string | null;
  isFeatured: boolean;
  photoCount: number;
  cover: MediaView | null;
  preview: MediaView[];
}

export interface GalleryIndex {
  page: PageIntro;
  categories: string[];
  albums: AlbumCard[];
}

export interface GalleryAlbumView {
  album: {
    id: number;
    slug: string;
    title: string;
    description: string | null;
    category: string | null;
    takenOn: string | null;
  };
  photos: { mediaId: number; caption: string }[];
  media: MediaMap;
  more: AlbumCard[];
}

export interface StaffPerson {
  id: number;
  name: string;
  position: string;
  department: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  photo: MediaView | null;
}

export interface StaffTier {
  id: number;
  name: string;
  description: string | null;
  members: StaffPerson[];
}

export interface StaffHierarchy {
  page: PageIntro;
  levels: StaffTier[];
}

/** A file on the Downloads page, with what visitors should know before downloading it. */
export interface DownloadFile {
  url: string;
  /** The file name the browser saves it as. */
  saveAs: string;
  /** "PDF", "Word", "Excel", "PowerPoint" or "Image". */
  type: string;
  sizeBytes: number;
}

export interface DownloadItem {
  id: number;
  categoryId: number;
  title: string;
  reference: string | null;
  summary: string | null;
  publishedOn: string;
  closesAt: string | null;
  isClosed: boolean;
  isPinned: boolean;
  file: DownloadFile;
}

export interface DownloadCategoryView {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  count: number;
}

export interface DownloadsIndex {
  page: PageIntro;
  categories: DownloadCategoryView[];
  items: DownloadItem[];
}
