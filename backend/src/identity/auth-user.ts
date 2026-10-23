/** The signed-in user as seen by guards, controllers and services. */
export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  /** Role keys, e.g. ["publisher"]. */
  roles: string[];
  /** Permissions that apply everywhere. */
  permissions: string[];
  /** Permissions limited to one page and its children (e.g. the Library editor). */
  scopedPermissions: { permission: string; pageId: number }[];
  twoFactorEnabled: boolean;
}

export interface RequestAuth {
  user: AuthUser;
  sessionId: string;
  twoFactorVerified: boolean;
}

/** Staff are users who can open the admin portal; they get shorter sessions and must use 2FA. */
export function isStaff(
  user: Pick<AuthUser, 'permissions' | 'scopedPermissions'>,
): boolean {
  return (
    user.permissions.includes('admin.access') ||
    user.scopedPermissions.some((p) => p.permission === 'admin.access')
  );
}

/**
 * True when the user holds the permission globally, or on the page itself or any of its ancestors.
 * `pageLineage` is the page id followed by its ancestor ids (closest first).
 */
export function can(
  user: AuthUser,
  permission: string,
  pageLineage: number[] = [],
): boolean {
  if (user.permissions.includes(permission)) return true;
  return user.scopedPermissions.some(
    (p) => p.permission === permission && pageLineage.includes(p.pageId),
  );
}

/** True when the user holds the permission anywhere (globally or on at least one section). */
export function canAnywhere(user: AuthUser, permission: string): boolean {
  return (
    user.permissions.includes(permission) ||
    user.scopedPermissions.some((p) => p.permission === permission)
  );
}
