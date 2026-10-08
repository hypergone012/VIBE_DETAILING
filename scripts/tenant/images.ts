import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Business } from './schema.ts';

export interface MediaFile {
  role: 'logo' | 'hero' | `work:${string}`;
  buffer: Buffer;
  contentType: string;
  /** Content-addressed name: identical input → identical object, so republishing is idempotent. */
  name: string;
}

const hash = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Web-ready copies of the studio images (WebP), named by content hash. */
export async function prepareMedia(dir: string, b: Business): Promise<MediaFile[]> {
  const out: MediaFile[] = [];
  const webp = async (rel: string, maxW: number, maxH: number, quality = 80) =>
    sharp(join(dir, rel)).rotate().resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();

  const logo = await sharp(join(dir, b.images.logo))
    .resize(512, 512, { fit: 'contain', background: '#000000' })
    .webp({ quality: 90 })
    .toBuffer();
  out.push({ role: 'logo', buffer: logo, contentType: 'image/webp', name: `logo-${hash(logo)}.webp` });

  const hero = await webp(b.images.hero, 1800, 2200, 78);
  out.push({ role: 'hero', buffer: hero, contentType: 'image/webp', name: `hero-${hash(hero)}.webp` });

  for (const w of b.works) {
    const buf = await webp(w.image, 1600, 1600, 78);
    out.push({ role: `work:${w.key}`, buffer: buf, contentType: 'image/webp', name: `work-${w.key}-${hash(buf)}.webp` });
  }
  return out;
}

/** iPhone/iPad portrait launch screens: [width, height, css width, css height, dpr]. */
export const STARTUP_SIZES: Array<[number, number, number, number, number]> = [
  [1320, 2868, 440, 956, 3],
  [1206, 2622, 402, 874, 3],
  [1290, 2796, 430, 932, 3],
  [1179, 2556, 393, 852, 3],
  [1284, 2778, 428, 926, 3],
  [1170, 2532, 390, 844, 3],
  [1125, 2436, 375, 812, 3],
  [1242, 2688, 414, 896, 3],
  [828, 1792, 414, 896, 2],
  [750, 1334, 375, 667, 2],
  [1640, 2360, 820, 1180, 2],
  [2048, 2732, 1024, 1366, 2],
];

export interface PwaAsset {
  file: string;
  buffer: Buffer;
}

/**
 * Per-studio install assets: any-purpose icons, a maskable icon with the logo inside
 * the 80% safe zone, an opaque apple-touch-icon, favicon, social preview and iOS
 * launch screens. Background is black to match the app.
 */
export async function pwaAssets(dir: string, b: Business): Promise<PwaAsset[]> {
  const src = join(dir, b.images.icon ?? b.images.logo);
  const square = (size: number, inner = 1) => {
    const innerSize = Math.round(size * inner);
    return sharp(src)
      .resize(innerSize, innerSize, { fit: 'contain', background: '#000000' })
      .flatten({ background: '#000000' })
      .extend({
        top: Math.floor((size - innerSize) / 2),
        bottom: Math.ceil((size - innerSize) / 2),
        left: Math.floor((size - innerSize) / 2),
        right: Math.ceil((size - innerSize) / 2),
        background: '#000000',
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  };

  const assets: PwaAsset[] = [
    { file: 'icons/icon-192.png', buffer: await square(192) },
    { file: 'icons/icon-512.png', buffer: await square(512) },
    { file: 'icons/maskable-512.png', buffer: await square(512, 0.66) },
    { file: 'icons/maskable-192.png', buffer: await square(192, 0.66) },
    { file: 'icons/apple-touch-icon.png', buffer: await square(180, 0.86) },
    { file: 'icons/favicon-32.png', buffer: await square(32) },
    {
      file: 'icons/og.jpg',
      buffer: await sharp(join(dir, b.images.hero)).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80 }).toBuffer(),
    },
  ];

  const logoPng = await sharp(src).resize(512, 512, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).png().toBuffer();
  for (const [w, h] of STARTUP_SIZES) {
    const logoSize = Math.round(Math.min(w, h) * 0.28);
    const logo = await sharp(logoPng).resize(logoSize, logoSize).toBuffer();
    const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } })
      .composite([{ input: logo, left: Math.round((w - logoSize) / 2), top: Math.round((h - logoSize) / 2) }])
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    assets.push({ file: `startup/${w}x${h}.png`, buffer: buf });
  }
  return assets;
}
