import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { BusinessSchema, formatIssues, parseDuration, parseHours, WEEKDAYS, type Business } from './schema.ts';

export const ROOT = resolve(import.meta.dirname, '../..');
export const TENANTS_DIR = join(ROOT, 'tenants');

/** Studio folders: tenants/<slug>/business.json, excluding _template and hidden dirs. */
export function listTenantSlugs(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
    .filter((d) => statSync(join(TENANTS_DIR, d)).isDirectory() && existsSync(join(TENANTS_DIR, d, 'business.json')))
    .sort();
}

export function tenantDir(slug: string): string {
  return join(TENANTS_DIR, slug);
}

export interface Loaded {
  slug: string;
  dir: string;
  business: Business | null;
  errors: string[];
}

export function loadBusiness(slug: string): Loaded {
  const dir = tenantDir(slug);
  const file = join(dir, 'business.json');
  if (!existsSync(file)) return { slug, dir, business: null, errors: [`нет файла ${file}`] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { slug, dir, business: null, errors: [`business.json: неверный JSON — ${(error as Error).message}`] };
  }
  const parsed = BusinessSchema.safeParse(raw);
  if (!parsed.success) return { slug, dir, business: null, errors: formatIssues(parsed.error) };
  const errors: string[] = [];
  if (parsed.data.slug !== slug) errors.push(`slug "${parsed.data.slug}" не совпадает с именем папки "${slug}"`);
  return { slug, dir, business: parsed.data, errors };
}

/** WCAG relative luminance contrast between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PLACEHOLDER = /(TODO|ЗАПОЛНИТЬ|example\.com|xxx|lorem|демо-адрес|000-00-00)/i;

export interface ValidationReport {
  slug: string;
  errors: string[];
  warnings: string[];
  business: Business | null;
}

/**
 * Full validation of a studio folder. `strict` is required before going live:
 * no demo flag, no placeholders, owner e-mail present, real-sized photos.
 */
export async function validateTenant(slug: string, { strict = false } = {}): Promise<ValidationReport> {
  const loaded = loadBusiness(slug);
  const errors = [...loaded.errors];
  const warnings: string[] = [];
  const b = loaded.business;
  if (!b) return { slug, errors, warnings, business: null };

  const checkImage = async (rel: string, label: string, min: { w: number; h: number }, square = false) => {
    const abs = join(loaded.dir, rel);
    if (!existsSync(abs)) {
      errors.push(`${label}: нет файла ${rel}`);
      return;
    }
    try {
      const meta = await sharp(abs).metadata();
      if (!meta.width || !meta.height) throw new Error('нет размеров');
      if (meta.width < min.w || meta.height < min.h) {
        (strict ? errors : warnings).push(`${label}: ${meta.width}×${meta.height}, нужно минимум ${min.w}×${min.h}`);
      }
      if (square && Math.abs(meta.width - meta.height) > Math.min(meta.width, meta.height) * 0.1) {
        warnings.push(`${label}: лучше квадратное изображение (сейчас ${meta.width}×${meta.height})`);
      }
    } catch (error) {
      errors.push(`${label}: не читается как изображение (${(error as Error).message})`);
    }
  };

  await checkImage(b.images.logo, 'Логотип', { w: 512, h: 512 }, true);
  await checkImage(b.images.hero, 'Главное фото', { w: 1200, h: 900 });
  if (b.images.icon) await checkImage(b.images.icon, 'Иконка', { w: 512, h: 512 }, true);
  for (const work of b.works) await checkImage(work.image, `Фото работы "${work.key}"`, { w: 800, h: 600 });
  if (b.works.length < 3) (strict ? errors : warnings).push(`Фото работ: ${b.works.length}, рекомендуем от 3`);

  if (contrastRatio(b.accentColor, '#000000') < 3) {
    warnings.push(`Акцент ${b.accentColor} плохо виден на чёрном фоне (контраст < 3:1)`);
  }
  if (b.shortName.length > 12) warnings.push(`shortName длиннее 12 символов — подпись под иконкой обрежется`);

  for (const s of b.services) {
    const minutes = parseDuration(s.duration) ?? 0;
    const fits = WEEKDAYS.some((d) =>
      (parseHours(b.hours[d]) ?? []).some((w) => {
        const [oh, om] = w.opens_at.split(':').map(Number) as [number, number];
        const [ch, cm] = w.closes_at.split(':').map(Number) as [number, number];
        return ch * 60 + cm - (oh * 60 + om) >= minutes;
      }),
    );
    if (!fits && minutes < 1440) {
      warnings.push(
        `Услуга "${s.name}" (${minutes} мин) не помещается ни в одно окно приёма: её можно будет записать только с выдачей в другой день`,
      );
    }
  }

  if (strict) {
    if (b.demo) errors.push('demo: true — это образец. Для запуска замените данные на настоящие и уберите флаг demo.');
    if (!b.owner?.email) errors.push('owner.email обязателен для запуска: владельцу нужен вход в кабинет');
    const texts = JSON.stringify({ ...b, $schema: undefined, images: undefined });
    const m = texts.match(PLACEHOLDER);
    if (m) errors.push(`В данных осталась заглушка: "${m[0]}"`);
  }

  return { slug, errors, warnings, business: b };
}

export function printReport(r: ValidationReport): void {
  const ok = r.errors.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${r.slug}${r.business ? ` — ${r.business.name}` : ''}`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
}
