#!/usr/bin/env tsx
/**
 * pnpm tenant:verify <slug> [--url https://host] [--browser]
 *
 * Checks a published studio link end to end:
 *   shell HTML and deep links return THIS studio's shell; owner shell is noindex;
 *   both manifests have the right id/start_url/scope and real icons;
 *   apple-touch-icon and launch screens exist; sw.js is served;
 *   the public API returns the studio, its photos load and there are free slots.
 * --browser additionally opens the page in Chromium (mobile), waits for the app,
 * asks Chrome DevTools for installability errors and checks the service worker scope.
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { pipelineEnv, publicClient, storagePublicUrl } from './env.ts';
import { loadBusiness } from './load.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { url: { type: 'string' }, browser: { type: 'boolean', default: false } },
});

const slug = positionals[0];
if (!slug) {
  console.error('Использование: pnpm tenant:verify <slug> [--url https://host] [--browser]');
  process.exit(2);
}

const env = pipelineEnv();
const site = (values.url ?? env.siteUrl ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const base = `/s/${slug}`;
const loaded = loadBusiness(slug);
const results: Array<{ ok: boolean; name: string; detail?: string }> = [];

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail: detail ?? undefined });
  } catch (error) {
    results.push({ ok: false, name, detail: (error as Error).message });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function get(path: string, accept = 'text/html') {
  const url = path.startsWith('http') ? path : `${site}${path}`;
  const res = await fetch(url, { headers: { accept }, redirect: 'follow' });
  return { res, url };
}

async function shellOf(path: string): Promise<string> {
  const { res, url } = await get(path);
  assert(res.status === 200, `${url} → HTTP ${res.status}`);
  const html = await res.text();
  const tenant = /<meta name="tenant" content="([^"]+)"/.exec(html)?.[1];
  assert(tenant === slug, `${url}: оболочка студии "${tenant ?? 'нет'}" вместо "${slug}"`);
  return html;
}

console.log(`Проверяю ${site}${base}/ (API: ${env.supabaseUrl})\n`);

await check('Оболочка клиента: метаданные студии', async () => {
  const html = await shellOf(`${base}/`);
  if (loaded.business) assert(html.includes(loaded.business.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')), 'нет названия в <title>/meta');
  assert(html.includes(`rel="manifest" href="${base}/manifest.webmanifest"`), 'нет ссылки на manifest студии');
  assert(html.includes(`rel="apple-touch-icon" href="${base}/icons/apple-touch-icon.png"`), 'нет apple-touch-icon');
  assert(html.includes('apple-mobile-web-app-capable'), 'нет apple-mobile-web-app-capable');
  assert(html.includes('Content-Security-Policy'), 'нет CSP');
  const startup = html.match(/apple-touch-startup-image/g)?.length ?? 0;
  assert(startup >= 10, `стартовых экранов iOS: ${startup}`);
  return `startup images: ${startup}`;
});

await check('Глубокие ссылки отдают оболочку этой студии', async () => {
  for (const p of [`${base}/services`, `${base}/my`, `${base}/my/ABC123`, `${base}/assistant`]) await shellOf(p);
});

await check('Кабинет: отдельная оболочка, noindex, свой manifest', async () => {
  for (const p of [`${base}/owner/`, `${base}/owner/settings`]) {
    const html = await shellOf(p);
    assert(html.includes('noindex'), `${p}: нет noindex`);
    assert(html.includes(`${base}/manifest-owner.webmanifest`), `${p}: нет manifest кабинета`);
  }
});

async function checkManifest(file: string, scope: string) {
  const { res, url } = await get(`${base}/${file}`, 'application/manifest+json');
  assert(res.status === 200, `${url} → HTTP ${res.status}`);
  const m = (await res.json()) as {
    id: string;
    scope: string;
    start_url: string;
    display: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  assert(m.id === scope, `id ${m.id} ≠ ${scope}`);
  assert(m.scope === scope, `scope ${m.scope} ≠ ${scope}`);
  assert(m.start_url.startsWith(scope), `start_url ${m.start_url} вне scope`);
  assert(m.display === 'standalone', `display ${m.display}`);
  for (const need of [
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ] as const) {
    const icon = m.icons.find((i) => i.sizes === need[0] && (i.purpose ?? 'any') === need[1]);
    assert(icon, `нет иконки ${need[0]} ${need[1]}`);
    const img = await get(icon.src, 'image/png');
    assert(img.res.status === 200, `${icon.src} → HTTP ${img.res.status}`);
    const meta = await sharp(Buffer.from(await img.res.arrayBuffer())).metadata();
    assert(`${meta.width}x${meta.height}` === need[0], `${icon.src}: ${meta.width}x${meta.height}`);
  }
}

await check('Manifest клиента: id/start_url/scope /s/{slug}/, иконки any+maskable', () => checkManifest('manifest.webmanifest', `${base}/`));
await check('Manifest кабинета: scope /s/{slug}/owner/', () => checkManifest('manifest-owner.webmanifest', `${base}/owner/`));

await check('apple-touch-icon 180×180 без прозрачности', async () => {
  const { res } = await get(`${base}/icons/apple-touch-icon.png`, 'image/png');
  assert(res.status === 200, `HTTP ${res.status}`);
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert(meta.width === 180 && meta.height === 180, `${meta.width}x${meta.height}`);
  assert(!meta.hasAlpha, 'есть альфа-канал');
});

await check('Service worker студии', async () => {
  const { res } = await get(`${base}/sw.js`, '*/*');
  assert(res.status === 200, `HTTP ${res.status}`);
  assert(/javascript/.test(res.headers.get('content-type') ?? ''), `content-type ${res.headers.get('content-type')}`);
  const body = await res.text();
  assert(body.includes('studio-'), 'в sw.js нет префикса кэшей студии');
});

let firstService: string | null = null;
await check('API: студия опубликована, данные из БД', async () => {
  const client = publicClient();
  const { data, error } = await client.rpc('get_public_tenant', { p_slug: slug });
  assert(!error, error?.message ?? '');
  const payload = data as {
    ok: boolean;
    error?: string;
    tenant: { status: string; name: string; hero_path: string | null };
    services: Array<{ id: string; bookable: boolean }>;
    photos: Array<{ path: string }>;
  };
  assert(payload.ok, `get_public_tenant: ${payload.error}`);
  const bookable = payload.services.filter((s) => s.bookable);
  assert(bookable.length > 0, 'нет услуг, доступных для записи');
  firstService = bookable[0]!.id;
  for (const path of [payload.tenant.hero_path, ...payload.photos.map((p) => p.path)].filter(Boolean) as string[]) {
    const res = await fetch(storagePublicUrl(path), { method: 'GET' });
    assert(res.status === 200, `фото ${path} → HTTP ${res.status}`);
  }
  return `статус ${payload.tenant.status}, услуг ${bookable.length}, фото ${payload.photos.length}`;
});

await check('Есть свободное время в ближайшие 14 дней', async () => {
  assert(firstService, 'нет услуги');
  const { data, error } = await publicClient().rpc('get_available_slots', { p_slug: slug, p_service_id: firstService, p_from: null, p_days: 14 });
  assert(!error, error?.message ?? '');
  const days = (data as { ok: boolean; days: Array<{ slots: Array<{ available: boolean }> }> }).days ?? [];
  const free = days.reduce((n, d) => n + d.slots.filter((s) => s.available).length, 0);
  assert(free > 0, 'свободных окон нет');
  return `свободных окон: ${free}`;
});

if (values.browser) {
  await check('Браузер: приложение загрузилось, PWA устанавливается, SW со scope студии', async () => {
    const { chromium, devices } = await import('@playwright/test');
    const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
      const context = await browser.newContext({ ...devices['Pixel 7'] });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(`${site}${base}/`, { waitUntil: 'load' });
      await page.waitForSelector('[data-app-ready="true"]', { timeout: 20_000 });
      const scope = await page.evaluate(async () => {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
        ]);
        return reg ? reg.scope : null;
      });
      assert(scope?.endsWith(`${base}/`), `scope SW: ${scope}`);
      const cdp = await context.newCDPSession(page);
      const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
        installabilityErrors: Array<{ errorId: string }>;
      };
      assert(installabilityErrors.length === 0, `Chrome: ${installabilityErrors.map((e) => e.errorId).join(', ')}`);
      const cacheNames = await page.evaluate(() => caches.keys());
      assert(cacheNames.some((n) => n.startsWith(`studio-${location.pathname.split('/')[2]}`)), `кэши: ${cacheNames.join(', ')}`);
      assert(errors.length === 0, `ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`);
      return `SW scope ${scope}; кэши: ${cacheNames.length}`;
    } finally {
      await browser.close();
    }
  });
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} проверок пройдено для ${site}${base}/`);
process.exit(failed ? 1 : 0);
