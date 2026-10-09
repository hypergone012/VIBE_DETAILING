import { fromZonedTime } from 'date-fns-tz';
import type { ISODateString, ISOTimeString } from '@astryxdesign/core/utils';
import type { BookingEvent, BookingStatus } from '@/api/ownerSchemas';
import { formatInStudio, formatMoney } from '@/lib/format';

export const OWNER_STATUS: Record<BookingStatus, { label: string; dot: 'success' | 'warning' | 'error' | 'accent' | 'neutral' }> = {
  confirmed: { label: 'Ждём машину', dot: 'accent' },
  arrived: { label: 'В работе', dot: 'warning' },
  done: { label: 'Готово', dot: 'success' },
  cancelled: { label: 'Отменена', dot: 'neutral' },
  no_show: { label: 'Не приехал', dot: 'error' },
};

export const PAYMENT_METHODS = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'transfer', label: 'Перевод' },
  { value: 'other', label: 'Другое' },
] as const;

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;

/** Calendar arithmetic on studio-local YYYY-MM-DD strings (noon UTC avoids DST edges). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - wd);
}

export const dayTitle = (date: string, pattern = 'EEEE, d MMMM') => formatInStudio(`${date}T12:00:00Z`, 'UTC', pattern);

/** Rubles typed by people → minor units sent to the server (and back). */
export const toMinor = (rubles: number) => Math.round(rubles * 100);
export const fromMinor = (minor: number) => minor / 100;

export function balanceOf(b: { price_minor: number; paid_minor: number; refunded_minor: number }) {
  return b.price_minor - (b.paid_minor - b.refunded_minor);
}

export function describeEvent(e: BookingEvent, timezone: string, currency: string): string {
  const p = e.payload ?? {};
  const who = e.actor === 'client' ? 'клиент' : e.actor === 'system' ? 'система' : 'студия';
  switch (e.kind) {
    case 'created':
      return `Запись создана (${who})`;
    case 'rescheduled':
      return typeof p.to === 'string'
        ? `Перенесена на ${formatInStudio(p.to, timezone, 'd MMMM, HH:mm')}`
        : 'Перенесена';
    case 'cancelled':
      return `Отменена (${who})`;
    case 'status': {
      const to = typeof p.to === 'string' && p.to in OWNER_STATUS ? OWNER_STATUS[p.to as BookingStatus].label : String(p.to ?? '');
      return `Статус: ${to}`;
    }
    case 'payment':
      return `Оплата ${formatMoney(Number(p.amount_minor ?? 0), currency)} · ${methodLabel(String(p.method ?? ''))}`;
    case 'refund':
      return `Возврат ${formatMoney(Number(p.amount_minor ?? 0), currency)} · ${methodLabel(String(p.method ?? ''))}`;
    default:
      return e.kind;
  }
}

/** "10:00–12:30" or "10:00 → 12 окт 14:00" for multi-day jobs, in the studio timezone. */
export function timeRange(startsAt: string, endsAt: string, timezone: string): string {
  const sameDay = formatInStudio(startsAt, timezone, 'yyyy-MM-dd') === formatInStudio(endsAt, timezone, 'yyyy-MM-dd');
  return sameDay
    ? `${formatInStudio(startsAt, timezone, 'HH:mm')}–${formatInStudio(endsAt, timezone, 'HH:mm')}`
    : `${formatInStudio(startsAt, timezone, 'HH:mm')} → ${formatInStudio(endsAt, timezone, 'd MMM HH:mm')}`;
}

/** Studio wall-clock date + time → UTC ISO instant. */
export function studioInstant(date: string, time: string, timezone: string): string {
  return fromZonedTime(`${date}T${time.length === 5 ? `${time}:00` : time}`, timezone).toISOString();
}

/** Branded string types of Astryx DateInput / TimeInput values. */
export const asDate = (value: string) => value as ISODateString;
export const asTime = (value: string) => value as ISOTimeString;
