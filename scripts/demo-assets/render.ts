/**
 * Renders the procedural demo photos of the two sample studios into
 * tenants/<slug>/images. Run once; the outputs are committed.
 *
 *   pnpm tsx scripts/demo-assets/render.ts
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

interface Shot {
  scene: string;
  file: string;
  width: number;
  height: number;
  opts?: Record<string, unknown>;
}

const root = resolve(import.meta.dirname, '../..');
const specs: Array<{ slug: string; accent: string; shots: Shot[] }> = [
  {
    slug: 'graphite',
    accent: '#4690FF',
    shots: [
      { scene: 'detailing-hero', file: 'images/hero.jpg', width: 1600, height: 2000 },
      { scene: 'logo', file: 'images/logo.png', width: 1024, height: 1024, opts: { text: 'G', shape: 'hex' } },
      { scene: 'detailing-polish', file: 'images/works/polish.jpg', width: 1600, height: 1200 },
      { scene: 'detailing-ceramic', file: 'images/works/ceramic.jpg', width: 1600, height: 1200 },
      { scene: 'detailing-interior', file: 'images/works/interior.jpg', width: 1600, height: 1200 },
      { scene: 'detailing-wheel', file: 'images/works/wheels.jpg', width: 1600, height: 1200 },
      { scene: 'detailing-foam', file: 'images/works/wash.jpg', width: 1600, height: 1200 },
    ],
  },
  {
    slug: 'severny-boks',
    accent: '#FFB020',
    shots: [
      { scene: 'service-hero', file: 'images/hero.jpg', width: 1600, height: 2000 },
      { scene: 'logo', file: 'images/logo.png', width: 1024, height: 1024, opts: { text: 'СБ', shape: 'oct' } },
      { scene: 'service-brakes', file: 'images/works/brakes.jpg', width: 1600, height: 1200 },
      { scene: 'service-tire', file: 'images/works/tires.jpg', width: 1600, height: 1200 },
      { scene: 'service-alignment', file: 'images/works/alignment.jpg', width: 1600, height: 1200 },
      { scene: 'service-oil', file: 'images/works/oil.jpg', width: 1600, height: 1200 },
    ],
  },
];

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: join(import.meta.dirname, 'scenes.js') });

for (const spec of specs) {
  for (const shot of spec.shots) {
    const dataUrl = await page.evaluate(
      ({ scene, width, height, accent, opts }) =>
        (window as unknown as { renderScene: (...a: unknown[]) => string }).renderScene(scene, width, height, accent, opts),
      { scene: shot.scene, width: shot.width, height: shot.height, accent: spec.accent, opts: shot.opts ?? {} },
    );
    const png = Buffer.from(dataUrl.split(',')[1]!, 'base64');
    const out = join(root, 'tenants', spec.slug, shot.file);
    mkdirSync(dirname(out), { recursive: true });
    const img = sharp(png);
    if (out.endsWith('.png')) await img.png({ compressionLevel: 9 }).toFile(out);
    else await img.jpeg({ quality: 84, mozjpeg: true }).toFile(out);
    console.log(`✓ ${spec.slug}/${shot.file}`);
  }
}
await browser.close();
