import { devices, expect, test } from '@playwright/test';

/**
 * PWA guarantees per studio on the production build (pnpm preview with the same
 * rewrites as Vercel/Cloudflare): own worker scope and cache names, the studio
 * shell and deep links open offline with the right studio, and the reminder UI
 * never promises push to an iPhone browser tab.
 */
test('each studio has its own worker and caches, and opens offline from a deep link', async ({ page, context }) => {
  for (const slug of ['graphite', 'severny-boks']) {
    await page.goto(`/s/${slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  }
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort());
  expect(scopes).toEqual(['/s/graphite/', '/s/severny-boks/']);
  const caches = await page.evaluate(async () => (await window.caches.keys()).sort());
  expect(caches.some((c) => c.startsWith('studio-graphite-'))).toBe(true);
  expect(caches.some((c) => c.startsWith('studio-severny-boks-'))).toBe(true);
  // Nothing private is cached: no API responses in any cache.
  const cachedApi = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await window.caches.keys()) for (const req of await (await window.caches.open(name)).keys()) urls.push(req.url);
    return urls.filter((u) => /\/(rest|auth|functions)\/v1\//.test(u));
  });
  expect(cachedApi).toEqual([]);

  await context.setOffline(true);
  await page.goto('/s/graphite/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/GRAPHITE/);
  await expect(page.getByText('Нет подключения к интернету')).toBeVisible();

  // A deep link of the OTHER studio that was not visited before still gets that studio's shell.
  await page.goto('/s/severny-boks/services');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Услуги и цены');
  await expect(page).toHaveTitle(/Северный бокс/);
  await context.setOffline(false);
});

const iphone = devices['iPhone 15'];

test.describe('reminders in an iPhone browser tab', () => {
  // iPhone Safari as the app sees it (user agent, touch, screen); the engine stays Chromium.
  test.use({ userAgent: iphone.userAgent, viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: true, hasTouch: true });

  test('ask to install the app instead of promising push; calendar file stays available', async ({ page }) => {
    await page.goto('/s/graphite/');
    await page.getByTestId('hero-book').click();
    const sheet = page.getByTestId('booking-sheet');
    await sheet.getByRole('button', { name: /мойка/i }).first().click();
    await sheet.locator('button.slot:not([disabled])').first().click();
    await sheet.getByLabel('Имя').fill('Проверка iPhone');
    await sheet.getByLabel('Телефон').fill('+7 900 765-43-21');
    await sheet.getByLabel('Автомобиль').fill('Mazda 3');
    await sheet.getByText('Согласен на обработку').click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Подтвердить запись' }).click();
    await expect(sheet.getByText(/^Код записи/)).toBeVisible();
    await page.getByRole('link', { name: 'Открыть мою запись' }).click();

    await expect(page.getByText('На iPhone уведомления работают только из приложения')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Напомнить за сутки' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить в календарь' })).toBeVisible();
  });
});
