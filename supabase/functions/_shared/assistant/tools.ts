/**
 * Server tools of the assistant. The model can only name a tool from its scope and
 * pass a period key, a service name or a date: no SQL, no tenant id, no customer
 * search. Client and owner tools are separate lists, and owner tools exist only
 * when the backend was built for a verified owner session.
 */
import { addDays, formatDay, formatDuration, formatMoney, formatTime, isoWeekday, localDate, matchServices, relativeDay } from './text.ts';
import { PERIOD_KEYS, type LlmToolSpec, type PeriodKey, type Scope, type ServiceInfo, type ToolBackend } from './types.ts';

export type ToolName =
  | 'studio_info'
  | 'list_services'
  | 'service_price'
  | 'next_free_slots'
  | 'my_booking'
  | 'owner_schedule'
  | 'owner_stats'
  | 'owner_free_slots';

export const TOOL_LABELS: Record<ToolName, string> = {
  studio_info: 'Адрес, часы и правила',
  list_services: 'Прайс',
  service_price: 'Цена услуги',
  next_free_slots: 'Свободное время',
  my_booking: 'Ваша запись',
  owner_schedule: 'Записи за период',
  owner_stats: 'Статистика за период',
  owner_free_slots: 'Свободное время',
};

export const CLIENT_TOOLS: ToolName[] = ['studio_info', 'list_services', 'service_price', 'next_free_slots', 'my_booking'];
export const OWNER_TOOLS: ToolName[] = ['owner_schedule', 'owner_stats', 'owner_free_slots', 'list_services', 'studio_info'];

export const toolsForScope = (scope: Scope): ToolName[] => (scope === 'owner' ? OWNER_TOOLS : CLIENT_TOOLS);

const periodParam = {
  type: 'string',
  enum: [...PERIOD_KEYS],
  description: 'Период в часовом поясе студии: today, tomorrow, this_week, last_week, this_month, last_30_days и т. п.',
};
const serviceParam = { type: 'string', description: 'Название услуги так, как его назвал человек (например «полировка»).' };
const dateParam = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'День в формате YYYY-MM-DD (по календарю студии).' };

const SPECS: Record<ToolName, LlmToolSpec> = {
  studio_info: fn('studio_info', 'Адрес, как проехать, телефон, часы работы, особые дни и правила отмены студии.', {}),
  list_services: fn('list_services', 'Список услуг студии с ценами и длительностью.', {}),
  service_price: fn('service_price', 'Цена и длительность конкретной услуги.', { service: serviceParam }, ['service']),
  next_free_slots: fn('next_free_slots', 'Ближайшее свободное время для записи на услугу (по реальному расписанию боксов).', {
    service: serviceParam,
    date: dateParam,
  }),
  my_booking: fn('my_booking', 'Запись клиента, открытая на этом устройстве: время, статус, можно ли отменить.', {}),
  owner_schedule: fn('owner_schedule', 'Записи студии за период: время, услуга, имя клиента, машина, бокс, статус.', { period: periodParam }, ['period']),
  owner_stats: fn(
    'owner_stats',
    'Статистика за период: заезды, выполненные заказы, полученные деньги и возвраты, ожидаемая стоимость запланированных визитов (не выручка).',
    { period: periodParam },
    ['period'],
  ),
  owner_free_slots: fn('owner_free_slots', 'Свободное время для записи на услугу.', { service: serviceParam, date: dateParam }),
};

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): LlmToolSpec {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}

export const toolSpecs = (scope: Scope): LlmToolSpec[] => toolsForScope(scope).map((n) => SPECS[n]);

export interface ToolContext {
  scope: Scope;
  backend: ToolBackend;
  now: Date;
}

export interface ToolResult {
  name: ToolName;
  args: Record<string, unknown>;
  ok: boolean;
  /** Compact, model-friendly data (no phone numbers, no other clients for the client scope). */
  data?: unknown;
  error?: string;
}

export class ToolRejected extends Error {}

/** Validates the tool name against the scope and the arguments against their tiny schema. */
export function parseToolCall(scope: Scope, name: string, rawArgs: unknown): { name: ToolName; args: Record<string, unknown> } {
  if (!toolsForScope(scope).includes(name as ToolName)) throw new ToolRejected(`Инструмент «${name}» недоступен в этом режиме`);
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  if ('period' in args) {
    if (typeof args.period !== 'string' || !(PERIOD_KEYS as readonly string[]).includes(args.period)) throw new ToolRejected('Неверный период');
    out.period = args.period;
  }
  if ('service' in args && args.service != null) {
    if (typeof args.service !== 'string' || args.service.length > 80) throw new ToolRejected('Неверное название услуги');
    out.service = args.service;
  }
  if ('date' in args && args.date != null) {
    if (typeof args.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ToolRejected('Неверная дата');
    out.date = args.date;
  }
  const required = (SPECS[name as ToolName].function.parameters as { required?: string[] }).required ?? [];
  for (const r of required) if (!(r in out)) throw new ToolRejected(`Не хватает параметра ${r}`);
  return { name: name as ToolName, args: out };
}

export async function runTool(ctx: ToolContext, name: ToolName, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return { name, args, ok: true, data: await execute(ctx, name, args) };
  } catch (error) {
    return { name, args, ok: false, error: error instanceof Error ? error.message : 'Ошибка инструмента' };
  }
}

function serviceRow(s: ServiceInfo, currency: string) {
  return {
    name: s.name,
    category: s.category,
    price: formatMoney(s.price_minor, currency, s.price_is_from),
    duration: formatDuration(s.duration_minutes),
    online_booking: s.bookable,
  };
}

async function pickService(ctx: ToolContext, query: unknown): Promise<{ service: ServiceInfo | null; candidates: ServiceInfo[]; all: ServiceInfo[] }> {
  const all = (await ctx.backend.services()).filter((s) => s.bookable || ctx.scope === 'owner');
  if (typeof query === 'string' && query.trim()) {
    const matches = matchServices(query, all);
    return { service: matches.length === 1 ? matches[0]! : null, candidates: matches, all };
  }
  return { service: null, candidates: [], all };
}

async function execute(ctx: ToolContext, name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  const studio = await ctx.backend.studio();
  const tz = studio.timezone;
  const today = localDate(ctx.now, tz);

  switch (name) {
    case 'studio_info': {
      const byDay = [1, 2, 3, 4, 5, 6, 7].map((wd) => ({
        weekday: wd,
        hours: studio.hours.filter((h) => h.weekday === wd).map((h) => `${h.opens_at}–${h.closes_at}`),
      }));
      const todayHours = byDay[isoWeekday(today) - 1]!.hours;
      return {
        name: studio.name,
        address: studio.address,
        how_to_get_there: studio.address_note,
        map_url: studio.map_url,
        phone: studio.phone_display ?? studio.phone,
        messenger_url: studio.messenger_url,
        today: formatDay(today),
        open_today: todayHours.length ? todayHours.join(', ') : 'выходной',
        weekly_hours: byDay.map((d) => `${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][d.weekday - 1]}: ${d.hours.length ? d.hours.join(', ') : 'выходной'}`),
        special_days: studio.exceptions
          .filter((e) => e.date >= today)
          .slice(0, 5)
          .map((e) => `${formatDay(e.date)}: ${e.is_closed ? 'выходной' : `${e.opens_at}–${e.closes_at}`}${e.note ? ` (${e.note})` : ''}`),
        online_cancel_until_hours: studio.rules.cancel_until_hours,
        booking_lead_minutes: studio.rules.min_lead_minutes,
        booking_horizon_days: studio.rules.horizon_days,
      };
    }
    case 'list_services': {
      const all = await ctx.backend.services();
      return { currency: studio.currency, services: all.map((s) => serviceRow(s, studio.currency)) };
    }
    case 'service_price': {
      const { service, candidates, all } = await pickService(ctx, args.service);
      if (service) return { match: serviceRow(service, studio.currency), description: service.description };
      if (candidates.length) return { ambiguous: true, candidates: candidates.map((s) => serviceRow(s, studio.currency)) };
      return { not_found: true, known_services: all.map((s) => s.name) };
    }
    case 'next_free_slots':
    case 'owner_free_slots': {
      const { service, candidates, all } = await pickService(ctx, args.service);
      const target = service ?? (args.service ? null : all[0] ?? null);
      if (!target) {
        return candidates.length
          ? { ambiguous: true, candidates: candidates.map((s) => s.name) }
          : { not_found: true, known_services: all.map((s) => s.name) };
      }
      const from = typeof args.date === 'string' && args.date >= today ? args.date : today;
      const days = await ctx.backend.slots(target.id, from, args.date ? 1 : 14);
      const free = days.flatMap((d) => d.slots.filter((s) => s.available).map((s) => ({ date: d.date, time: s.time })));
      const firstDay = free[0]?.date;
      return {
        service: target.name,
        assumed_service: !service,
        duration: formatDuration(target.duration_minutes),
        searched_from: formatDay(from),
        searched_days: args.date ? 1 : 14,
        first_free_day: firstDay ? relativeDay(firstDay, today) : null,
        times_on_first_free_day: firstDay ? free.filter((f) => f.date === firstDay).slice(0, 8).map((f) => f.time) : [],
        other_days: [...new Set(free.map((f) => f.date))].slice(1, 4).map((d) => relativeDay(d, today)),
        nothing_free: free.length === 0,
      };
    }
    case 'my_booking': {
      if (!ctx.backend.myBooking) return { no_booking_on_device: true };
      const b = await ctx.backend.myBooking();
      if (!b) return { no_booking_on_device: true };
      return {
        code: b.code,
        status: b.status,
        service: b.service_name,
        day: relativeDay(localDate(new Date(b.starts_at), tz), today),
        time: formatTime(b.starts_at, tz),
        ready_at: `${relativeDay(localDate(new Date(b.ends_at), tz), today)} ${formatTime(b.ends_at, tz)}`,
        box: b.resource_name,
        can_cancel_online: b.can_cancel,
      };
    }
    case 'owner_schedule': {
      if (!ctx.backend.schedule) throw new ToolRejected('Только для владельца студии');
      const s = await ctx.backend.schedule(args.period as PeriodKey);
      return {
        period: periodLabel(s.period.from, s.period.to),
        bookings_count: s.bookings.filter((b) => b.status !== 'cancelled').length,
        blocks: s.blocks,
        bookings: s.bookings.slice(0, 40).map((b) => ({
          day: relativeDay(localDate(new Date(b.starts_at), tz), today),
          time: `${formatTime(b.starts_at, tz)}–${formatTime(b.ends_at, tz)}`,
          service: b.service_name,
          client: b.customer_name.split(' ')[0],
          car: b.car_label,
          box: b.resource_name,
          status: b.status,
        })),
      };
    }
    case 'owner_stats': {
      if (!ctx.backend.stats) throw new ToolRejected('Только для владельца студии');
      const s = await ctx.backend.stats(args.period as PeriodKey);
      const money = (m: number) => formatMoney(m, s.currency);
      return {
        period: periodLabel(s.period.from, s.period.to),
        timezone: s.period.timezone,
        visits_cars_arrived: s.visits,
        completed_jobs: s.completed,
        money_received_net: money(s.net_received_minor),
        payments_received: money(s.received_minor),
        refunds: money(s.refunded_minor),
        payments_count: s.payments_count,
        planned_visits: s.scheduled_count,
        planned_value_not_revenue: money(s.scheduled_value_minor),
        new_bookings: s.new_bookings,
        cancellations: s.cancellations,
        no_shows: s.no_shows,
      };
    }
  }
}

export function periodLabel(from: string, to: string): string {
  return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
}

export { addDays };
