import { describe, expect, it } from 'vitest';
import { SERVICES, TODAY } from './fixtures.test-helpers.ts';
import { extractPeriod, routeMessage } from './router.ts';
import { extractDate, matchServices } from './text.ts';

const client = (text: string) => routeMessage({ text, scope: 'client', services: SERVICES, today: TODAY });
const owner = (text: string) => routeMessage({ text, scope: 'owner', services: SERVICES, today: TODAY });

describe('client router', () => {
  it.each([
    ['Когда ближайшее окно?', 'next_slot'],
    ['Есть свободное время на завтра?', 'next_slot'],
    ['Когда можно записаться на полировку?', 'next_slot'],
    ['Сколько стоит полировка кузова?', 'price'],
    ['А керамика почём?', 'price'],
    ['Как найти студию?', 'address'],
    ['Где вы находитесь, есть парковка?', 'address'],
    ['До скольки вы работаете в субботу?', 'hours'],
    ['Какой у вас телефон?', 'contacts'],
    ['Как отменить запись?', 'cancel_policy'],
    ['Когда моя запись?', 'my_booking'],
    ['Какие услуги вы делаете?', 'services'],
    ['химчистка', 'price'],
    ['Привет!', 'other'],
  ])('%s → %s', (question, intent) => {
    expect(client(question).intent).toBe(intent);
  });

  it('finds the service named in the question, in any case form', () => {
    expect(client('Сколько стоит полировка кузова?').services[0]?.name).toBe('Полировка кузова');
    expect(client('Хочу полировку').services[0]?.name).toBe('Полировка кузова');
    expect(client('Сколько стоит керамика?').services[0]?.name).toBe('Керамическое покрытие');
    expect(client('бронеплёнку на капот').services[0]?.name).toBe('Бронеплёнка: зона риска');
    expect(client('Когда ближайшее окно?').services).toEqual([]);
  });

  it('extracts the day in the studio calendar', () => {
    expect(client('свободно завтра?').date).toBe('2026-10-10');
    expect(client('а послезавтра?').date).toBe('2026-10-11');
    expect(client('в понедельник можно?').date).toBe('2026-10-12');
    expect(client('на 15 октября').date).toBe('2026-10-15');
    expect(extractDate('5 января', TODAY)).toBe('2027-01-05');
    expect(client('Когда ближайшее окно?').date).toBeNull();
  });
});

describe('owner router', () => {
  it.each([
    ['Что у меня завтра?', 'schedule', 'tomorrow'],
    ['Кто записан на сегодня?', 'schedule', 'today'],
    ['Сколько машин было на неделе?', 'stats_visits', 'this_week'],
    ['Сколько машин было на прошлой неделе?', 'stats_visits', 'last_week'],
    ['Сколько денег получено?', 'stats_money', 'this_week'],
    ['Какая выручка в этом месяце?', 'stats_money', 'this_month'],
    ['Сколько заказов выполнили вчера?', 'stats_completed', 'yesterday'],
    ['Есть свободные окна на полировку в субботу?', 'free_slots', null],
    ['Привет', 'other', 'today'],
  ])('%s → %s (%s)', (question, intent, period) => {
    const r = owner(question);
    expect(r.intent).toBe(intent);
    expect(r.period).toBe(period);
  });

  it('uses the same period keys as SQL', () => {
    expect(extractPeriod('за 30 дней')).toBe('last_30_days');
    expect(extractPeriod('за последние 7 дней')).toBe('last_7_days');
    expect(extractPeriod('на следующей неделе')).toBe('next_week');
    expect(extractPeriod('в прошлом месяце')).toBe('last_month');
    expect(extractPeriod('просто вопрос')).toBeNull();
  });
});

describe('service matching', () => {
  it('returns nothing for unrelated words and several for an ambiguous word', () => {
    expect(matchServices('погода', SERVICES)).toEqual([]);
    expect(matchServices('защита', SERVICES).map((s) => s.name).sort()).toEqual(['Бронеплёнка: зона риска', 'Керамическое покрытие']);
  });
});
