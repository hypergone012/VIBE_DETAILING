import { expect, test, type Page } from '@playwright/test';

/**
 * The main promise of the product, end to end against the local Supabase stack
 * (pnpm local:bootstrap): a client picks a service and a real free time, confirms
 * without registration, and the booking appears in the owner's cabinet.
 */
const SLUG = process.env.E2E_SLUG ?? 'graphite';
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? `owner@${SLUG}.example`;
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? `demo-${SLUG}-local`;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

async function apiReachable(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get(`${SUPABASE_URL}/auth/v1/health`, { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

test('client books a service and the owner sees the booking', async ({ page, browser }, testInfo) => {
  const customer = `Проверка ${testInfo.project.name} ${Date.now().toString(36)}`;

  // --- Client: service → time → contacts → confirm ---------------------------
  test.skip(!(await apiReachable(page)), `Supabase is not reachable at ${SUPABASE_URL} (run pnpm local:bootstrap)`);
  await page.goto(`/s/${SLUG}/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByTestId('hero-book').click();

  const sheet = page.getByTestId('booking-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /мойка/i }).first().click();

  // Only real free times are offered; busy ones are disabled (crossed out).
  const freeSlot = sheet.locator('button.slot:not([disabled])').first();
  await expect(freeSlot).toBeVisible();
  const time = (await freeSlot.innerText()).trim();
  await freeSlot.click();

  await sheet.getByLabel('Имя').fill(customer);
  await sheet.getByLabel('Телефон').fill('+7 900 123-45-67');
  await sheet.getByLabel('Автомобиль').fill('Skoda Octavia, серая');
  await sheet.getByText('Согласен на обработку').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Подтвердить запись' }).click();

  const codeText = await sheet.getByText(/^Код записи [A-Z0-9]{6}$/).innerText();
  const code = codeText.replace('Код записи ', '');
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // The booking is kept on this device under "Моя запись".
  await page.goto(`/s/${SLUG}/my`);
  await expect(page.getByRole('link', { name: new RegExp(`${time}`) }).first()).toBeVisible();

  // --- Owner: sign in and find the booking by its code ------------------------
  const ownerContext = await browser.newContext({ ...testInfo.project.use });
  const owner = await ownerContext.newPage();
  await owner.goto(`/s/${SLUG}/owner/`);
  await owner.getByLabel('Почта').fill(OWNER_EMAIL);
  await owner.getByLabel('Пароль').fill(OWNER_PASSWORD);
  await owner.getByRole('button', { name: 'Войти' }).click();
  await expect(owner.getByRole('heading', { name: 'Записи', level: 1 })).toBeVisible();
  await owner.getByRole('radio', { name: 'Неделя' }).click();

  // The booking may fall in a later week: walk forward week by week, each time
  // waiting until that week's schedule has loaded.
  const row = owner.locator('li', { hasText: customer });
  const weekTitle = owner.getByRole('heading', { level: 2 });
  for (let week = 0; week < 5; week++) {
    await expect(owner.getByText(/^Записей: \d+$/)).toBeVisible();
    await owner.waitForLoadState('networkidle');
    if (await row.count()) break;
    const before = await weekTitle.innerText();
    await owner.getByRole('button', { name: 'Вперёд' }).click();
    await expect(weekTitle).not.toHaveText(before);
  }
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText(time);
  await row.first().locator('a').click();
  await expect(owner.getByText(`Код ${code}`)).toBeVisible();
  await expect(owner.getByText(customer)).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Машина приехала' })).toBeVisible();
  await ownerContext.close();
});
