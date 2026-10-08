import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served with the same tenant rewrites as
 * Vercel/Cloudflare (`pnpm preview`), backed by the local Supabase stack.
 * The sandbox ships a Chromium that differs from the Playwright pin, so an explicit
 * executable is used when present (PW_CHROMIUM_PATH overrides).
 */
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const launchOptions = executablePath ? { executablePath } : {};
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm preview',
        url: `${baseURL}/healthz.txt`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
