/** Top-level slugs used by the application itself, which pages may not take. */
export const RESERVED_TOP_LEVEL_SLUGS = new Set([
  'admin',
  'api',
  'media',
  'portal',
  'preview',
  'login',
  'apply',
  'timetable',
  'search',
  'assets',
]);

/** "Fees & Funding 2027!" -> "fees-funding-2027" */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 150;
}

export function joinPath(parentPath: string | null, slug: string): string {
  const base = !parentPath || parentPath === '/' ? '' : parentPath;
  return `${base}/${slug}`;
}

/** Normalises a visitor-supplied path: leading slash, no trailing slash, no query/hash, lowercase. */
export function normalizePath(input: string): string {
  let path = decodeURIComponent(input.split(/[?#]/)[0] || '/')
    .trim()
    .toLowerCase();
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path;
}

export const TRASH_SUFFIX = '~trash-';
export const trashedPath = (path: string, id: number) =>
  `${path}${TRASH_SUFFIX}${id}`.slice(0, 500);
export const originalPath = (path: string) => path.split(TRASH_SUFFIX)[0];
