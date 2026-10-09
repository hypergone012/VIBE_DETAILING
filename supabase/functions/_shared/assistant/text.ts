/**
 * Small Russian text helpers for the assistant (no dependencies): normalisation,
 * crude stemming for matching service names, dates in the studio timezone.
 */
import type { ServiceInfo } from './types.ts';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'“”„.,!?;:()[\]{}…/\\|+*_=~`^-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  'сколько', 'стоит', 'стоимость', 'цена', 'цены', 'почем', 'а', 'и', 'в', 'на', 'за', 'по', 'у', 'вас', 'мне', 'нужна',
  'нужно', 'нужен', 'хочу', 'можно', 'есть', 'ли', 'какая', 'какой', 'какие', 'когда', 'ближайшее', 'окно', 'свободное',
  'время', 'запись', 'записаться', 'это', 'ваш', 'ваша', 'услуга', 'услуги', 'машины', 'машину', 'авто', 'автомобиля',
  'будет', 'сделать', 'делаете', 'для', 'с', 'со', 'от', 'до', 'что', 'как', 'же',
]);

/** Crude Russian stem: drop common endings so «полировку», «полировки», «полировка» meet. */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ую|юю|ая|яя|ое|ее|ой|ей|ий|ый|ов|ев|ам|ям|ах|ях|ом|ем|ую|а|я|у|ю|ы|и|е|о|ь)$/u, '');
}

export function keywords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 2);
}

/**
 * Services mentioned in a message, best first. Matches on stems of the service
 * name and category; a prefix match counts (e.g. «керамик» ⊂ «керамическое»).
 */
export function matchServices(text: string, services: ServiceInfo[]): ServiceInfo[] {
  const words = keywords(text);
  if (!words.length) return [];
  const scored = services
    .map((s) => {
      const nameStems = keywords(`${s.name} ${s.category ?? ''}`);
      let score = 0;
      for (const w of words) {
        if (nameStems.includes(w)) score += 3;
        else if (nameStems.some((n) => (n.length >= 4 && w.length >= 4 && (n.startsWith(w.slice(0, 5)) || w.startsWith(n.slice(0, 5)))))) score += 2;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const best = scored[0]!.score;
  return scored.filter((x) => x.score >= best - 1).map((x) => x.s);
}

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday) of a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};
const WEEKDAYS: [RegExp, number][] = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[ау]/, 3],
  [/четверг/, 4],
  [/пятниц[ау]/, 5],
  [/суббот[ау]/, 6],
  [/воскресень[ея]/, 7],
];

/**
 * Whole-word test on normalised text. JS `\b` treats Cyrillic letters as
 * non-word characters, so word boundaries are spelled out with spaces.
 */
export function hasWord(normalized: string, ...words: string[]): boolean {
  const padded = ` ${normalized} `;
  return words.some((w) => padded.includes(` ${w} `));
}

/** A specific day named in the message («завтра», «в субботу», «15 октября»), in the studio calendar. */
export function extractDate(text: string, today: string): string | null {
  const t = normalize(text);
  if (hasWord(t, 'послезавтра')) return addDays(today, 2);
  if (hasWord(t, 'завтра', 'завтрашний', 'завтрашнее')) return addDays(today, 1);
  if (hasWord(t, 'сегодня', 'сегодняшний')) return today;
  const m = t.match(/(?:^|\s)(\d{1,2})\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS[m[2]!]!;
    let year = Number(today.slice(0, 4));
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (candidate < today) year += 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(t)) {
      const diff = (wd - isoWeekday(today) + 7) % 7;
      return addDays(today, diff);
    }
  }
  return null;
}

export function formatMoney(minor: number, currency: string, from = false): string {
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
export { plural };

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

/** «пт, 10 октября» for a YYYY-MM-DD date. */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00Z`));
}

/** «10:30» of an instant in the studio timezone. */
export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** «сегодня» / «завтра» / «пт, 10 октября». */
export function relativeDay(date: string, today: string): string {
  if (date === today) return 'сегодня';
  if (date === addDays(today, 1)) return 'завтра';
  return formatDay(date);
}
