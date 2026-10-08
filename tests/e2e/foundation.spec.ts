import { expect, test } from '@playwright/test';

/**
 * Foundation smoke test from `astryx docs migration`: a broken cascade-layer order
 * fails silently on every page, so it is asserted before any feature test.
 */
test('Astryx keeps component padding and shadcn drawer uses Astryx tokens', async ({ page }) => {
  await page.goto('/__foundation');
  const button = page.locator('[data-foundation-check] button').first();
  await expect(button).toBeVisible();
  const paddingInline = await button.evaluate((el) => getComputedStyle(el).paddingInlineStart);
  expect(paddingInline).not.toBe('0px');

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe('rgb(0, 0, 0)');

  await button.click();
  const drawer = page.getByTestId('foundation-drawer');
  await expect(drawer).toBeVisible();
  const [drawerBg, popoverToken] = await drawer.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--color-background-popover)';
    el.appendChild(probe);
    const tokenColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(el).backgroundColor, tokenColor];
  });
  expect(drawerBg).toBe(popoverToken);

  // Effective layer order = order of first appearance (statements or blocks) in the CSSOM.
  const layers = await page.evaluate(() => {
    const order: string[] = [];
    const add = (name: string) => {
      if (name && !order.includes(name)) order.push(name);
    };
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSLayerStatementRule) rule.nameList.forEach(add);
        else if (rule instanceof CSSLayerBlockRule) {
          add(rule.name);
          walk(rule.cssRules);
        } else if (rule instanceof CSSImportRule && rule.layerName) add(rule.layerName);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    return order.filter((name) => name !== 'properties');
  });
  expect(layers.slice(0, 8)).toEqual([
    'reset',
    'theme',
    'base',
    'astryx-base',
    'astryx-theme',
    'components',
    'utilities',
    'app',
  ]);
});
