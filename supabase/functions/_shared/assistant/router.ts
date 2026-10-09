/**
 * Intent router: maps a Russian question to the server tool that must run BEFORE
 * the model answers (so answers about time, prices and bookings are grounded in
 * data). Deterministic and tested on its own (tests/unit/assistant-router.test.ts).
 */
import { extractDate, hasWord, matchServices, normalize } from './text.ts';
import type { PeriodKey, Scope, ServiceInfo } from './types.ts';

export type ClientIntent =
  | 'my_booking'
  | 'cancel_policy'
  | 'next_slot'
  | 'price'
  | 'services'
  | 'address'
  | 'hours'
  | 'contacts'
  | 'how_to_book'
  | 'other';

export type OwnerIntent = 'stats_money' | 'stats_visits' | 'stats_completed' | 'free_slots' | 'schedule' | 'services' | 'other';

export interface Route {
  scope: Scope;
  intent: ClientIntent | OwnerIntent;
  /** Studio-calendar day named in the question, if any. */
  date: string | null;
  /** Reporting period (owner), same keys as the cabinet and SQL. */
  period: PeriodKey | null;
  /** Services mentioned in the question, best match first. */
  services: ServiceInfo[];
  /** What to pass to service tools: the exact name for one match, the person's words otherwise. */
  serviceQuery: string | null;
}

const CLIENT_RULES: [ClientIntent, RegExp][] = [
  ['my_booking', /(мо[яюей] запис|я записан|мой визит|моей записи|когда мне приезжать|на когда я)/],
  ['cancel_policy', /(отмен|перенест|перенос)/],
  ['next_slot', /(ближайш|свободн|окн[оа]|когда можно|когда смож|когда примете|есть ли время|есть время|успеете|на какое время|во сколько можно)/],
  ['price', /(сколько стоит|стоимост|цен[аыу]|почем|прайс|сколько будет)/],
  ['address', /(где вы|где наход|адрес|как вас найти|как найти|найти студ|как добраться|как проехать|карт[аеу]|парковк|въезд|навигатор)/],
  ['hours', /(часы работы|до скольки|во сколько (вы )?(открыва|закрыва|работа)|режим работы|график|выходн|работаете ли|открыты)/],
  ['contacts', /(телефон|позвонить|номер|связаться|телеграм|ватсап|whatsapp|мессенджер)/],
  ['how_to_book', /(как записаться|записать(ся)? можно|хочу записаться|запишите|оформить запись)/],
  ['services', /(какие услуги|что вы делаете|чем занимаетесь|услуги|что делаете|список услуг)/],
];

const OWNER_RULES: [OwnerIntent, RegExp][] = [
  ['stats_money', /(деньг|выручк|получен|заработ|оплат|касс|доход|сколько денег|сумм[аы] за|возврат)/],
  ['stats_completed', /(сколько (заказов )?(выполн|сделал|закрыл|готов)|выполнен|готовых)/],
  ['stats_visits', /(сколько (машин|авто|клиентов|заездов|приехал)|заезд|приехало|машин было|клиентов было)/],
  ['free_slots', /(свободн|окн[оа]|есть ли место|можно ли записать|когда можно записать|ближайш)/],
  ['schedule', /(что у меня|записи|расписан|кто приедет|кто записан|кто будет|загрузк|план на|что на |что в |сколько записей)/],
  ['services', /(услуг|прайс|цен[аыу])/],
];

/** Reporting period named in an owner question («на неделе», «в прошлом месяце», «завтра»). */
export function extractPeriod(text: string): PeriodKey | null {
  const t = normalize(text);
  if (hasWord(t, 'сегодня', 'сегодняшний', 'сегодняшние')) return 'today';
  if (hasWord(t, 'завтра', 'завтрашний', 'завтрашние')) return 'tomorrow';
  if (hasWord(t, 'вчера', 'вчерашний')) return 'yesterday';
  const week = /недел/.test(t);
  const month = /месяц/.test(t);
  const prev = /(прошл|предыдущ)/.test(t);
  const next = /(следующ|будущ)/.test(t);
  if (week && prev) return 'last_week';
  if (week && next) return 'next_week';
  if (/(7|семь) дн/.test(t)) return next || /ближайш/.test(t) ? 'next_7_days' : 'last_7_days';
  if (/(30|тридцать) дн/.test(t)) return 'last_30_days';
  if (month && prev) return 'last_month';
  if (month) return 'this_month';
  if (week) return 'this_week';
  return null;
}

export function routeMessage(params: { text: string; scope: Scope; services: ServiceInfo[]; today: string }): Route {
  const t = normalize(params.text);
  const services = matchServices(params.text, params.services);
  const date = extractDate(params.text, params.today);
  const serviceQuery = services.length === 1 ? services[0]!.name : services.length ? params.text.slice(0, 80) : null;

  if (params.scope === 'owner') {
    const intent = OWNER_RULES.find(([, re]) => re.test(t))?.[0] ?? (services.length ? 'free_slots' : 'other');
    const named = extractPeriod(params.text);
    const period: PeriodKey | null =
      intent === 'schedule' || intent === 'other'
        ? (named ?? 'today')
        : intent.startsWith('stats_')
          ? (named ?? 'this_week')
          : named;
    return { scope: 'owner', intent, date, period, services, serviceQuery };
  }

  let intent: ClientIntent = CLIENT_RULES.find(([, re]) => re.test(t))?.[0] ?? 'other';
  // «А полировка?» right after a price question, or just a service name: answer with its price.
  if (intent === 'other' && services.length) intent = 'price';
  return { scope: 'client', intent, date, period: null, services, serviceQuery };
}
