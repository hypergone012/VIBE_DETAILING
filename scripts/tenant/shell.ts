/**
 * Per-studio HTML shells and web app manifests. One shared JS/CSS build; each studio
 * gets its own metadata, manifests (distinct id/start_url/scope), icons, launch
 * screens and service-worker URL under /s/{slug}/.
 */
import { CLIENT_ROUTE_PREFIXES, OWNER_SEGMENT } from '../../src/app/routePaths.ts';
import { STARTUP_SIZES } from './images.ts';
import type { Business } from './schema.ts';

export const HEAD_MARKER = '<!--tenant-head-->';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON safe to embed in a <script type="application/json"> block. */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export interface ShellOptions {
  supabaseUrl: string;
  siteUrl?: string;
}

export function contentSecurityPolicy(supabaseUrl: string): string {
  const api = supabaseUrl ? new URL(supabaseUrl).origin : '';
  const ws = api.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Astryx runtime theme injects a <style> element.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${ws}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

function absolute(siteUrl: string | undefined, path: string): string {
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}${path}` : path;
}

export function shellHead(b: Business, app: 'client' | 'owner', opts: ShellOptions): string {
  const base = `/s/${b.slug}`;
  const isOwner = app === 'owner';
  const title = isOwner ? `Кабинет · ${b.name}` : `${b.name} — онлайн-запись`;
  const description = isOwner
    ? `Кабинет владельца: записи, оплаты и настройки студии ${b.name}.`
    : (b.tagline ?? b.description ?? `Запись онлайн в ${b.name}`);
  const appTitle = isOwner ? 'Кабинет' : b.shortName;
  const manifest = isOwner ? `${base}/manifest-owner.webmanifest` : `${base}/manifest.webmanifest`;
  const noindex = isOwner || b.demo;
  const boot = { slug: b.slug, name: b.name, shortName: b.shortName, accent: b.accentColor.toUpperCase(), app, demo: b.demo };

  const lines = [
    `<meta name="tenant" content="${esc(b.slug)}" />`,
    `<meta name="description" content="${esc(description)}" />`,
    noindex ? '<meta name="robots" content="noindex, nofollow" />' : '',
    `<meta http-equiv="Content-Security-Policy" content="${esc(contentSecurityPolicy(opts.supabaseUrl))}" />`,
    `<link rel="manifest" href="${manifest}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}/icons/favicon-32.png" />`,
    `<link rel="apple-touch-icon" href="${base}/icons/apple-touch-icon.png" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<meta name="apple-mobile-web-app-title" content="${esc(appTitle)}" />`,
    `<meta name="application-name" content="${esc(appTitle)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${esc(absolute(opts.siteUrl, `${base}/icons/og.jpg`))}" />`,
    opts.siteUrl ? `<meta property="og:url" content="${esc(absolute(opts.siteUrl, `${base}/`))}" />` : '',
    ...STARTUP_SIZES.map(
      ([w, h, cw, ch, dpr]) =>
        `<link rel="apple-touch-startup-image" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="${base}/startup/${w}x${h}.png" />`,
    ),
    opts.supabaseUrl ? `<link rel="preconnect" href="${esc(new URL(opts.supabaseUrl).origin)}" crossorigin />` : '',
    `<script id="tenant-boot" type="application/json">${safeJson(boot)}</script>`,
  ];
  return lines.filter(Boolean).join('\n    ');
}

export function renderShell(template: string, b: Business, app: 'client' | 'owner', opts: ShellOptions): string {
  if (!template.includes(HEAD_MARKER)) throw new Error(`index.html has no ${HEAD_MARKER} marker`);
  const title = app === 'owner' ? `Кабинет · ${b.name}` : `${b.name} — онлайн-запись`;
  return template
    .replace(HEAD_MARKER, shellHead(b, app, opts))
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
}

export function manifest(b: Business, app: 'client' | 'owner') {
  const base = `/s/${b.slug}`;
  const scope = app === 'owner' ? `${base}/${OWNER_SEGMENT}/` : `${base}/`;
  const icons = [
    { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  if (app === 'owner') {
    return {
      id: scope,
      name: `Кабинет · ${b.name}`,
      short_name: 'Кабинет',
      description: `Записи, оплаты и настройки студии ${b.name}`,
      lang: b.locale.split('-')[0],
      dir: 'ltr',
      start_url: `${scope}?source=pwa`,
      scope,
      display: 'standalone',
      orientation: 'any',
      background_color: '#000000',
      theme_color: '#000000',
      icons,
      categories: ['business', 'productivity'],
      prefer_related_applications: false,
    };
  }
  return {
    id: scope,
    name: b.name,
    short_name: b.shortName,
    description: b.tagline ?? b.description ?? `Запись онлайн в ${b.name}`,
    lang: b.locale.split('-')[0],
    dir: 'ltr',
    start_url: `${scope}?source=pwa`,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    icons,
    shortcuts: [
      { name: 'Записаться', short_name: 'Запись', url: `${scope}?book=1`, icons: [{ src: icons[0]!.src, sizes: '192x192' }] },
      { name: 'Моя запись', short_name: 'Моя запись', url: `${scope}my`, icons: [{ src: icons[0]!.src, sizes: '192x192' }] },
    ],
    categories: ['lifestyle', 'business'],
    prefer_related_applications: false,
  };
}

/** Host rewrite rules (Cloudflare Pages `_redirects` syntax). Files always win: only SPA routes are listed. */
export function cloudflareRedirects(): string {
  const rules = [
    '# Generated by scripts/build/tenant-shells.ts — SPA deep links return the right studio shell.',
    '/s/:slug /s/:slug/ 301',
    `/s/:slug/${OWNER_SEGMENT} /s/:slug/${OWNER_SEGMENT}/ 301`,
    `/s/:slug/${OWNER_SEGMENT}/* /s/:slug/${OWNER_SEGMENT}/index.html 200`,
    ...CLIENT_ROUTE_PREFIXES.flatMap((p) => [`/s/:slug/${p} /s/:slug/index.html 200`, `/s/:slug/${p}/* /s/:slug/index.html 200`]),
  ];
  return `${rules.join('\n')}\n`;
}

export function cloudflareHeaders(): string {
  return [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/s/*/sw.js',
    '  Cache-Control: no-cache',
    '/s/*/*.webmanifest',
    '  Content-Type: application/manifest+json',
    '  Cache-Control: no-cache',
    '',
  ].join('\n');
}

/** Resolve a request path like the hosts do (used by the preview server and tests). */
export function resolveTenantRewrite(pathname: string): string | null {
  const m = /^\/s\/([a-z0-9-]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const slug = m[1]!;
  const rest = (m[2] ?? '/').replace(/^\//, '');
  if (rest === '' || rest === 'index.html') return `/s/${slug}/index.html`;
  const first = rest.split('/')[0]!;
  if (first === OWNER_SEGMENT) {
    const ownerRest = rest.slice(OWNER_SEGMENT.length).replace(/^\//, '');
    if (ownerRest === '' || !/\.[a-z0-9]+$/i.test(ownerRest)) return `/s/${slug}/${OWNER_SEGMENT}/index.html`;
    return null;
  }
  if ((CLIENT_ROUTE_PREFIXES as readonly string[]).includes(first)) return `/s/${slug}/index.html`;
  return null;
}
