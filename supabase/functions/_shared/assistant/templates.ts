/**
 * Deterministic answers built only from tool results. Used when the model is not
 * configured or unavailable, and when its output cannot be used — so the
 * assistant still answers from real data (and booking never depends on it).
 */
import type { Route } from './router.ts';
import type { ToolResult } from './tools.ts';

type Data = Record<string, unknown>;

const find = (results: ToolResult[], name: string): Data | null => {
  const r = results.find((x) => x.name === name && x.ok);
  return r ? ((r.data ?? {}) as Data) : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function templateAnswer(route: Route, results: ToolResult[]): string {
  if (results.length && results.every((r) => !r.ok)) {
    return 'Не получилось получить данные студии. Попробуйте ещё раз через минуту или позвоните в студию.';
  }
  if (route.scope === 'owner') return ownerAnswer(route, results);

  const info = find(results, 'studio_info');
  switch (route.intent) {
    case 'next_slot': {
      const s = find(results, 'next_free_slots');
      if (!s) break;
      if (s.ambiguous) return `Уточните, на какую услугу смотреть время: ${list(s.candidates).join(', ')}.`;
      if (s.not_found) return `Не нашёл такую услугу. Есть: ${list(s.known_services).slice(0, 6).join(', ')}. Какая нужна?`;
      if (s.nothing_free) return `На «${s.service}» свободного времени в ближайшие дни нет. Позвоните в студию — иногда освобождается время.`;
      const others = list(s.other_days);
      return (
        `Ближайшее свободное время на «${s.service}» — ${s.first_free_day}: ${list(s.times_on_first_free_day).join(', ')}.` +
        (others.length ? ` Есть окна и ${others.join(', ')}.` : '') +
        (s.assumed_service ? ' Если нужна другая услуга — напишите какая.' : '') +
        ' Записаться можно кнопкой «Записаться».'
      );
    }
    case 'price': {
      const p = find(results, 'service_price');
      if (p?.match) {
        const m = p.match as Data;
        return `«${m.name}» — ${m.price}, по времени около ${m.duration}.${String(m.price).startsWith('от') ? ' Точная цена — после осмотра машины.' : ''}`;
      }
      if (p?.ambiguous) {
        const c = (p.candidates as Data[]).map((x) => `«${x.name}» — ${x.price}`);
        return `Подходят несколько услуг: ${c.join('; ')}. Какая именно интересует?`;
      }
      const l = find(results, 'list_services');
      if (l) return `Уточните, какая услуга интересует. Например: ${(l.services as Data[]).slice(0, 5).map((x) => `${x.name} — ${x.price}`).join('; ')}.`;
      break;
    }
    case 'services': {
      const l = find(results, 'list_services');
      if (l) return `Услуги и цены: ${(l.services as Data[]).slice(0, 8).map((x) => `${x.name} — ${x.price}`).join('; ')}.`;
      break;
    }
    case 'my_booking': {
      const b = find(results, 'my_booking');
      if (!b || b.no_booking_on_device) return 'На этом устройстве нет вашей записи. Откройте ссылку на запись или позвоните в студию.';
      return `Ваша запись ${b.code}: «${b.service}», ${b.day} в ${b.time}, ${b.box}. ${b.can_cancel_online ? 'Отменить можно в разделе «Моя запись».' : 'Отменить онлайн уже нельзя — позвоните в студию.'}`;
    }
    case 'address':
      if (info) return [`Адрес: ${info.address ?? 'уточните в студии'}.`, info.how_to_get_there, info.map_url ? `Карта: ${info.map_url}` : null].filter(Boolean).join(' ');
      break;
    case 'hours':
      if (info) {
        const special = list(info.special_days);
        return `Сегодня (${info.today}): ${info.open_today}. График: ${list(info.weekly_hours).join('; ')}.${special.length ? ` Особые дни: ${special.join('; ')}.` : ''}`;
      }
      break;
    case 'contacts':
      if (info) return info.phone ? `Телефон студии: ${info.phone}.` : 'Телефон студии не указан — напишите нам через запись.';
      break;
    case 'cancel_policy':
      if (info) {
        const h = Number(info.online_cancel_until_hours);
        return `${h > 0 ? `Отменить запись онлайн можно не позднее чем за ${h} ч до визита` : 'Отменить запись онлайн можно до визита'} — в разделе «Моя запись». Перенести время проще звонком${info.phone ? `: ${info.phone}` : ''}.`;
      }
      break;
    case 'how_to_book':
      return 'Нажмите «Записаться», выберите услугу и свободное время, оставьте имя, телефон и машину — регистрация не нужна.';
    default:
      break;
  }
  return 'Я отвечаю по данным студии: услуги и цены, свободное время, адрес и часы работы. Спросите, например: «Когда ближайшее окно?»';
}

function ownerAnswer(route: Route, results: ToolResult[]): string {
  const stats = find(results, 'owner_stats');
  const schedule = find(results, 'owner_schedule');
  switch (route.intent) {
    case 'stats_money':
      if (stats) {
        return `За ${stats.period}: получено ${stats.money_received_net} (оплат: ${stats.payments_count}, возвраты: ${stats.refunds}). Ожидаемая стоимость запланированных визитов — ${stats.planned_value_not_revenue}, это ещё не выручка.`;
      }
      break;
    case 'stats_visits':
      if (stats) return `За ${stats.period}: заездов ${stats.visits_cars_arrived}, выполнено заказов ${stats.completed_jobs}. Новых записей: ${stats.new_bookings}, отмен: ${stats.cancellations}.`;
      break;
    case 'stats_completed':
      if (stats) return `За ${stats.period} выполнено заказов: ${stats.completed_jobs} (заездов: ${stats.visits_cars_arrived}).`;
      break;
    case 'free_slots': {
      const s = find(results, 'owner_free_slots');
      if (s?.ambiguous) return `Уточните услугу: ${list(s.candidates).join(', ')}.`;
      if (s?.nothing_free) return `На «${s.service}» свободного времени нет.`;
      if (s && !s.not_found) return `Свободно на «${s.service}» — ${s.first_free_day}: ${list(s.times_on_first_free_day).join(', ')}.`;
      break;
    }
    case 'services': {
      const l = find(results, 'list_services');
      if (l) return `Прайс: ${(l.services as Data[]).map((x) => `${x.name} — ${x.price}`).join('; ')}.`;
      break;
    }
    default:
      break;
  }
  if (schedule) {
    const items = schedule.bookings as Data[];
    const active = items.filter((b) => b.status !== 'cancelled');
    if (!active.length) return `${capitalize(String(schedule.period))}: записей нет.`;
    return `${capitalize(String(schedule.period))}: записей ${active.length}. ${active
      .slice(0, 10)
      .map((b) => `${b.day === 'сегодня' || b.day === 'завтра' ? '' : `${b.day} `}${b.time} ${b.service} — ${b.client}, ${b.car}`)
      .join('; ')}.`;
  }
  return 'Спросите про записи, заезды или деньги за период, например: «Что у меня завтра?»';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
