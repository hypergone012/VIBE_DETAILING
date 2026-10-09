/// <reference lib="webworker" />
/**
 * Service worker (vite-plugin-pwa, injectManifest). The same file is copied to
 * /s/{slug}/sw.js for every studio, so each studio has its own registration scope
 * and its own cache names (prefixed with the slug taken from the scope).
 *
 * Cached:     the hashed app bundle (precache), the studio's HTML shells, its icons
 *             and public studio photos from Storage.
 * Not cached: anything from /rest/v1, /auth/v1, /functions/v1 — bookings, owner data,
 *             tokens and assistant answers always go to the network.
 */
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const scopeUrl = new URL(self.registration.scope);
const base = scopeUrl.pathname.replace(/\/$/, ''); // "/s/{slug}"
const slug = /^\/s\/([^/]+)$/.exec(base)?.[1] ?? 'root';
const prefix = `studio-${slug}`;
const SHELL_CACHE = `${prefix}-shell-v1`;
const MEDIA_CACHE = `${prefix}-media-v2`;
const ASSET_CACHE = `${prefix}-assets-v1`;
const OWN_CACHES = [SHELL_CACHE, MEDIA_CACHE, ASSET_CACHE];

setCacheNameDetails({ prefix, suffix: 'v1' });
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const SHELLS = [`${base}/`, `${base}/owner/`];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELLS))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(`${prefix}-`) && k.includes('-v') && !k.includes('precache') && !OWN_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

clientsClaim();

// Navigations: network first (fresh studio metadata), cached shell when offline.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(`${base}/`),
  async ({ request, url }) => {
    const shell = url.pathname.startsWith(`${base}/owner`) ? `${base}/owner/` : `${base}/`;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(shell, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(shell, { cacheName: SHELL_CACHE });
      return cached ?? Response.error();
    }
  },
);

// Studio install assets (icons, manifests, launch screens).
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    url.pathname.startsWith(`${base}/`) &&
    /\/(icons|startup)\/|\.webmanifest$/.test(url.pathname),
  new StaleWhileRevalidate({ cacheName: ASSET_CACHE }),
);

// Public studio photos from Supabase Storage (never private data). Every <img> of
// tenant media is requested with crossOrigin="anonymous" (the liquid-glass lens
// snapshots them via CORS), so only real 200 CORS responses are cached: an opaque
// entry would break those CORS reads.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.includes('/storage/v1/object/public/tenant-media/'),
  new CacheFirst({
    cacheName: MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true }),
    ],
  }),
);

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
  if (data?.type === 'CLEAR_PRIVATE') {
    // Owner logout: nothing private is cached, but drop everything except the
    // precached bundle and public photos so no cabinet response can linger.
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith(`${prefix}-`) && !k.includes('precache') && k !== MEDIA_CACHE).map((k) => caches.delete(k))),
        ),
    );
  }
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const target = payload.url && payload.url.startsWith(`${base}/`) ? payload.url : `${base}/my`;
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Напоминание о записи', {
      body: payload.body ?? 'Откройте приложение, чтобы посмотреть детали.',
      icon: `${base}/icons/icon-192.png`,
      badge: `${base}/icons/maskable-192.png`,
      tag: payload.tag ?? `${prefix}-reminder`,
      data: { url: target },
      lang: 'ru',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? `${base}/my`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const inScope = clients.find((c) => new URL(c.url).pathname.startsWith(`${base}/`));
      if (inScope) {
        await inScope.focus();
        return inScope.navigate(url).then(() => undefined);
      }
      await self.clients.openWindow(url);
      return undefined;
    }),
  );
});
