import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

/** "3 500 ₽" / "от 18 000 ₽". Money always comes in minor units from the server. */
export function formatMoney(minor: number, currency = 'RUB', from = false): string {
  const fractional = minor % 100 !== 0;
  const text = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: fractional ? 2 : 0,
  }).format(minor / 100);
  return from ? `от ${text}` : text;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** 90 → "1 ч 30 мин", 2880 → "2 дня", 1680 → "1 день 4 ч". */
export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`);
  if (hours) parts.push(`${hours} ч`);
  if (mins) parts.push(`${mins} мин`);
  return parts.join(' ') || '0 мин';
}

export function formatInStudio(iso: string | Date, timezone: string, pattern: string): string {
  return formatInTimeZone(iso, timezone, pattern, { locale: ru });
}

/** "завтра, 12 марта, 10:00" style label in the studio timezone. */
export function formatSlotLong(iso: string, timezone: string, now = new Date()): string {
  const day = formatInStudio(iso, timezone, 'yyyy-MM-dd');
  const today = formatInStudio(now, timezone, 'yyyy-MM-dd');
  const tomorrow = formatInStudio(new Date(now.getTime() + 86_400_000), timezone, 'yyyy-MM-dd');
  const prefix = day === today ? 'сегодня, ' : day === tomorrow ? 'завтра, ' : '';
  return `${prefix}${formatInStudio(iso, timezone, 'd MMMM, EEEEEE, HH:mm')}`;
}

export function studioToday(timezone: string, now = new Date()): string {
  return formatInStudio(now, timezone, 'yyyy-MM-dd');
}

/** Offset label like "UTC+5" for the studio timezone at a given instant. */
export function utcOffsetLabel(timezone: string, at = new Date()): string {
  const offset = formatInTimeZone(at, timezone, 'xxx'); // "+05:00"
  const [h, m] = offset.slice(1).split(':');
  const sign = offset.startsWith('-') ? '−' : '+';
  return `UTC${sign}${Number(h)}${m && m !== '00' ? `:${m}` : ''}`;
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Studio and device clocks differ right now (not just by zone name). */
export function timezonesDiffer(timezone: string, at = new Date()): boolean {
  return formatInTimeZone(at, timezone, 'xxx') !== formatInTimeZone(at, deviceTimezone(), 'xxx');
}

export const WEEKDAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** ISO weekday (1 = Monday) of a local YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function formatPhoneHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
