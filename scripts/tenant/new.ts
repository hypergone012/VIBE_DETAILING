#!/usr/bin/env tsx
/**
 * pnpm tenant:new <slug> --name "Название студии" [--accent #4690FF] [--timezone Europe/Moscow]
 *                         [--from <existing-slug>]
 *
 * Creates tenants/<slug>/ from the template (or copies another studio as a starting
 * point) with placeholder images, so the studio can be published as a preview at once.
 * Existing studios are never touched.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { isValidTimezone } from './schema.ts';
import { printReport, TENANTS_DIR, validateTenant } from './load.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    accent: { type: 'string', default: '#4690FF' },
    timezone: { type: 'string', default: 'Europe/Moscow' },
    from: { type: 'string' },
  },
});

const slug = positionals[0];
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
  fail('Укажите slug: латиница в нижнем регистре, цифры и дефис. Пример: pnpm tenant:new detail-pro --name "Detail Pro"');
}
if (!values.name?.trim()) fail('Укажите название: --name "Название студии"');
if (!/^#[0-9A-Fa-f]{6}$/.test(values.accent)) fail('--accent в формате #RRGGBB');
if (!isValidTimezone(values.timezone)) fail(`Неизвестный часовой пояс ${values.timezone}`);

const dir = join(TENANTS_DIR, slug!);
if (existsSync(dir)) fail(`Папка tenants/${slug} уже существует — существующие студии не перезаписываются.`);

const name = values.name!.trim();
const shortName = (name.split(/\s+/)[0] ?? name).replace(/[«»"]/g, '').slice(0, 12);

if (values.from) {
  const src = join(TENANTS_DIR, values.from);
  if (!existsSync(join(src, 'business.json'))) fail(`Нет студии tenants/${values.from}`);
  cpSync(src, dir, { recursive: true, filter: (p) => !p.includes('.publish') });
  const b = JSON.parse(readFileSync(join(dir, 'business.json'), 'utf8')) as Record<string, unknown>;
  Object.assign(b, { slug, name, shortName, accentColor: values.accent.toUpperCase(), timezone: values.timezone, demo: true });
  delete b.owner;
  writeFileSync(join(dir, 'business.json'), `${JSON.stringify(b, null, 2)}\n`);
} else {
  cpSync(join(TENANTS_DIR, '_template'), dir, { recursive: true });
  const text = readFileSync(join(dir, 'business.json'), 'utf8')
    .replace('__SLUG__', slug!)
    .replace('__NAME__', name.replace(/"/g, '\\"'))
    .replace('__SHORT__', shortName.replace(/"/g, '\\"'))
    .replace('__ACCENT__', values.accent.toUpperCase())
    .replace('__TIMEZONE__', values.timezone);
  writeFileSync(join(dir, 'business.json'), text);

  // Placeholder images so the preview is publishable immediately.
  const initials = name
    .replace(/[«»"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#000"/>
    <circle cx="512" cy="512" r="360" fill="none" stroke="${values.accent}" stroke-width="44"/>
    <text x="512" y="600" font-family="DejaVu Sans, Arial, sans-serif" font-size="300" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials)}</text>
  </svg>`;
  const scene = (w: number, h: number, label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="g" cx="30%" cy="20%" r="90%">
        <stop offset="0" stop-color="${values.accent}" stop-opacity="0.55"/>
        <stop offset="0.6" stop-color="#0b0d12"/>
        <stop offset="1" stop-color="#000"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="${w / 2}" y="${h / 2}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(w / 18)}" fill="#ffffff" fill-opacity="0.55" text-anchor="middle">${esc(label)}</text>
  </svg>`;
  mkdirSync(join(dir, 'images', 'works'), { recursive: true });
  await sharp(Buffer.from(logo)).png().toFile(join(dir, 'images', 'logo.png'));
  await sharp(Buffer.from(scene(1600, 2000, 'Замените на фото студии'))).jpeg({ quality: 82 }).toFile(join(dir, 'images', 'hero.jpg'));
  for (const n of [1, 2, 3]) {
    await sharp(Buffer.from(scene(1600, 1200, `Фото работы ${n}`))).jpeg({ quality: 82 }).toFile(join(dir, 'images', 'works', `work-${n}.jpg`));
  }
}

const report = await validateTenant(slug!);
printReport(report);
console.log(`
Готово: tenants/${slug}/
Дальше:
  1. Заполните tenants/${slug}/business.json и замените фото в images/.
  2. pnpm tenant:validate ${slug}
  3. pnpm tenant:publish ${slug}          — образец (preview) в базе
  4. pnpm build && деплой               — оболочка /s/${slug}/ с иконкой
  5. pnpm tenant:verify ${slug} --url https://ваш-домен
  6. Настоящие данные + owner.email → pnpm tenant:publish ${slug} --live`);
