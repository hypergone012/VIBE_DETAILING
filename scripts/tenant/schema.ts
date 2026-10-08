/**
 * business.json — the single input file of a studio (plus images next to it).
 *
 * Human-friendly on purpose: prices in rubles, durations like "1h 30m" or "2d",
 * hours like "09:00-21:00" or "closed". `normalizeBusiness()` turns it into the
 * exact payload of public.admin_publish_tenant (minor units, minutes, ISO weekdays).
 */
import { z } from 'zod';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const INFO_CARD_ICONS = ['sparkle', 'shield', 'clock', 'drop', 'car', 'star', 'wrench', 'medal', 'coffee', 'camera'] as const;

const key = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'латиница в нижнем регистре, цифры и дефис (до 48 символов)');

const imagePath = z
  .string()
  .regex(/^images\/[A-Za-z0-9._/-]+\.(jpe?g|png|webp|avif)$/i, 'путь внутри папки images/: jpg, png, webp или avif');

const timeRange = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/** "1h 30m", "90m", "2d", "1d 4h", or a plain number of minutes. */
export function parseDuration(input: string | number): number | null {
  if (typeof input === 'number') return Number.isInteger(input) && input > 0 ? input : null;
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+)\s*(d|h|m|д|ч|мин|м)(?=\s|\d|$)/g;
  let total = 0;
  let consumed = '';
  for (const match of s.matchAll(re)) {
    const n = Number(match[1]);
    const unit = match[2];
    if (unit === 'd' || unit === 'д') total += n * 1440;
    else if (unit === 'h' || unit === 'ч') total += n * 60;
    else total += n;
    consumed += match[0];
  }
  if (!total || consumed.replace(/\s/g, '').length !== s.replace(/\s/g, '').length) return null;
  return total;
}

const duration = z.union([z.string(), z.number()]).refine((v) => parseDuration(v) !== null, {
  message: 'длительность вида "1h 30m", "90m", "2d" или число минут',
});

/** "09:00-13:00, 14:00-21:00" | "closed" → windows. */
export function parseHours(input: string): Array<{ opens_at: string; closes_at: string }> | null {
  const s = input.trim().toLowerCase();
  if (s === 'closed' || s === 'выходной') return [];
  const parts = s.split(',').map((p) => p.trim().replace(/\s/g, ''));
  const windows: Array<{ opens_at: string; closes_at: string }> = [];
  for (const part of parts) {
    if (!timeRange.test(part)) return null;
    const [opens_at, closes_at] = part.split('-') as [string, string];
    if (closes_at <= opens_at) return null;
    windows.push({ opens_at, closes_at });
  }
  windows.sort((a, b) => a.opens_at.localeCompare(b.opens_at));
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i]!.opens_at < windows[i - 1]!.closes_at) return null;
  }
  return windows;
}

const hours = z.string().refine((v) => parseHours(v) !== null, {
  message: 'часы вида "09:00-21:00", "09:00-13:00, 14:00-20:00" или "closed"',
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата YYYY-MM-DD');

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const BusinessSchema = z
  .object({
    $schema: z.string().optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'slug: латиница, цифры, дефис; 1–40 символов'),
    demo: z.boolean().default(false).describe('true — образец с вымышленными данными; запуск в live запрещён'),
    name: z.string().trim().min(1).max(80),
    shortName: z.string().trim().min(1).max(24).describe('Подпись под иконкой на главном экране (лучше до 12 символов)'),
    tagline: z.string().trim().max(120).optional(),
    description: z.string().trim().max(600).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'цвет #RRGGBB'),
    timezone: z.string().refine(isValidTimezone, 'неизвестный часовой пояс IANA, например Europe/Moscow'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('RUB'),
    locale: z.string().default('ru-RU'),
    contacts: z.object({
      phone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, 'телефон: минимум 10 цифр'),
      phoneDisplay: z.string().max(32).optional(),
      address: z.string().trim().min(3).max(200),
      addressNote: z.string().trim().max(300).optional(),
      mapUrl: z.url({ protocol: /^https$/ }).optional(),
      geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
      messengerUrl: z.url({ protocol: /^https$/ }).optional(),
    }),
    owner: z
      .object({ email: z.email() })
      .optional()
      .describe('Почта владельца: tenant:publish создаёт вход в кабинет'),
    images: z.object({
      logo: imagePath,
      hero: imagePath,
      heroAlt: z.string().trim().max(160).optional(),
      icon: imagePath.optional().describe('Квадратная иконка приложения; по умолчанию — логотип'),
    }),
    infoCards: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(40),
          text: z.string().trim().min(1).max(160),
          icon: z.enum(INFO_CARD_ICONS).default('sparkle'),
        }),
      )
      .length(3, 'нужно ровно три информационные карточки'),
    booking: z
      .object({
        slotStepMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(30),
        minLeadMinutes: z.number().int().min(0).max(10080).default(120),
        horizonDays: z.number().int().min(1).max(180).default(30),
        cancelUntilHours: z.number().int().min(0).max(168).default(12),
      })
      .default({ slotStepMinutes: 30, minLeadMinutes: 120, horizonDays: 30, cancelUntilHours: 12 }),
    resources: z
      .array(
        z.object({
          key,
          name: z.string().trim().min(1).max(60),
          kind: z.enum(['box', 'lift', 'bay', 'master']).default('box'),
        }),
      )
      .min(1, 'нужен хотя бы один бокс/пост'),
    services: z
      .array(
        z.object({
          key,
          name: z.string().trim().min(1).max(80),
          description: z.string().trim().max(400).optional(),
          category: z.string().trim().max(40).optional(),
          price: z.number().min(0).max(10_000_000).describe('Цена в рублях'),
          priceFrom: z.boolean().default(false).describe('Показывать «от …»'),
          duration,
          buffer: duration.optional().describe('Подготовка бокса после машины'),
          resources: z.union([z.literal('all'), z.array(key).min(1)]).default('all'),
        }),
      )
      .min(1, 'нужна хотя бы одна услуга'),
    hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, hours])) as Record<Weekday, typeof hours>),
    closedDates: z.array(z.object({ date: isoDate, note: z.string().max(120).optional() })).default([]),
    specialHours: z
      .array(z.object({ date: isoDate, hours: z.string().regex(timeRange), note: z.string().max(120).optional() }))
      .default([]),
    works: z
      .array(z.object({ key, image: imagePath, caption: z.string().trim().max(140).optional() }))
      .default([]),
  })
  .superRefine((b, ctx) => {
    const resourceKeys = new Set(b.resources.map((r) => r.key));
    const dupe = (items: Array<{ key: string }>, path: string) => {
      const seen = new Set<string>();
      for (const [i, item] of items.entries()) {
        if (seen.has(item.key)) ctx.addIssue({ code: 'custom', path: [path, i, 'key'], message: `повтор ключа "${item.key}"` });
        seen.add(item.key);
      }
    };
    dupe(b.resources, 'resources');
    dupe(b.services, 'services');
    dupe(b.works, 'works');
    for (const [i, s] of b.services.entries()) {
      if (s.resources !== 'all') {
        for (const r of s.resources) {
          if (!resourceKeys.has(r)) ctx.addIssue({ code: 'custom', path: ['services', i, 'resources'], message: `нет бокса "${r}"` });
        }
      }
      const minutes = parseDuration(s.duration) ?? 0;
      if (minutes < 15 || minutes > 20160) {
        ctx.addIssue({ code: 'custom', path: ['services', i, 'duration'], message: 'длительность от 15 минут до 14 дней' });
      }
    }
    if (WEEKDAYS.every((d) => parseHours(b.hours[d])?.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['hours'], message: 'студия не может быть закрыта всю неделю' });
    }
    const dates = [...b.closedDates.map((d) => d.date), ...b.specialHours.map((d) => d.date)];
    if (new Set(dates).size !== dates.length) {
      ctx.addIssue({ code: 'custom', path: ['closedDates'], message: 'одна дата указана дважды' });
    }
  });

export type Business = z.infer<typeof BusinessSchema>;

export interface MediaPaths {
  logo_path: string | null;
  hero_path: string | null;
  works: Record<string, string>;
}

/** Payload for public.admin_publish_tenant. */
export function normalizeBusiness(b: Business, media: MediaPaths) {
  const allResources = b.resources.map((r) => r.key);
  return {
    slug: b.slug,
    name: b.name,
    short_name: b.shortName,
    tagline: b.tagline ?? null,
    description: b.description ?? null,
    timezone: b.timezone,
    currency: b.currency,
    locale: b.locale,
    accent_color: b.accentColor.toUpperCase(),
    contacts: {
      phone: b.contacts.phone,
      phone_display: b.contacts.phoneDisplay ?? b.contacts.phone,
      address: b.contacts.address,
      address_note: b.contacts.addressNote ?? null,
      map_url: b.contacts.mapUrl ?? null,
      geo: b.contacts.geo ?? null,
      messenger_url: b.contacts.messengerUrl ?? null,
    },
    media: { logo_path: media.logo_path, hero_path: media.hero_path, hero_alt: b.images.heroAlt ?? null },
    info_cards: b.infoCards,
    booking: {
      slot_step_minutes: b.booking.slotStepMinutes,
      min_lead_minutes: b.booking.minLeadMinutes,
      horizon_days: b.booking.horizonDays,
      cancel_until_hours: b.booking.cancelUntilHours,
    },
    resources: b.resources.map((r, i) => ({ key: r.key, name: r.name, kind: r.kind, sort: (i + 1) * 10 })),
    services: b.services.map((s, i) => ({
      key: s.key,
      name: s.name,
      description: s.description ?? null,
      category: s.category ?? null,
      price_minor: Math.round(s.price * 100),
      price_is_from: s.priceFrom,
      duration_minutes: parseDuration(s.duration)!,
      buffer_minutes: s.buffer === undefined ? 0 : parseDuration(s.buffer)!,
      resources: s.resources === 'all' ? allResources : s.resources,
      sort: (i + 1) * 10,
    })),
    hours: WEEKDAYS.flatMap((d, i) => (parseHours(b.hours[d]) ?? []).map((w) => ({ weekday: i + 1, ...w }))),
    exceptions: [
      ...b.closedDates.map((d) => ({ date: d.date, is_closed: true, note: d.note ?? null })),
      ...b.specialHours.map((d) => {
        const [opens_at, closes_at] = d.hours.split('-');
        return { date: d.date, is_closed: false, opens_at, closes_at, note: d.note ?? null };
      }),
    ],
    photos: b.works
      .filter((w) => media.works[w.key])
      .map((w, i) => ({ key: w.key, path: media.works[w.key]!, caption: w.caption ?? null, sort: (i + 1) * 10 })),
  };
}

export type PublishConfig = ReturnType<typeof normalizeBusiness>;

/** Readable "path: message" lines from a ZodError. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`);
}
