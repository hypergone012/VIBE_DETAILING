/**
 * URL shape of the app. Shared by the router and by the build step that writes
 * host rewrite rules, so a deep link always gets the right studio's HTML shell.
 *
 *   /s/{slug}/                      studio page (client app)
 *   /s/{slug}/services              services & prices
 *   /s/{slug}/my                    "Моя запись" (token from this device)
 *   /s/{slug}/my/{code}             a specific booking on this device
 *   /s/{slug}/assistant             assistant
 *   /s/{slug}/owner/...             owner cabinet (separate shell + manifest)
 *
 * The booking sheet is addressed by query (?book=1&step=...), so Back walks steps.
 */
export const CLIENT_ROUTE_PREFIXES = ['services', 'my', 'assistant', 'privacy'] as const;
export const OWNER_SEGMENT = 'owner';

export const TENANT_SLUG_RE = /^\/s\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?:\/|$)/;

export function tenantSlugFromPath(pathname: string): string | null {
  return TENANT_SLUG_RE.exec(pathname)?.[1] ?? null;
}

export function isOwnerPath(pathname: string): boolean {
  return /^\/s\/[^/]+\/owner(?:\/|$)/.test(pathname);
}

export const tenantBase = (slug: string) => `/s/${slug}`;
