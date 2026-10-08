import { describe, expect, it } from 'vitest';
import { BusinessSchema, normalizeBusiness, parseDuration, parseHours } from './schema.ts';

describe('parseDuration', () => {
  it.each([
    ['90m', 90],
    ['1h 30m', 90],
    ['1h30m', 90],
    ['2d', 2880],
    ['1d 4h', 1680],
    ['2 ч', 120],
    ['45 мин', 45],
    ['3д', 4320],
    [120, 120],
    ['120', 120],
  ])('%s → %s minutes', (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });
  it.each(['', 'abc', '1x', '2 days', '-5', 0, 1.5])('rejects %s', (input) => {
    expect(parseDuration(input as string | number)).toBeNull();
  });
});

describe('parseHours', () => {
  it('parses single and split windows', () => {
    expect(parseHours('09:00-21:00')).toEqual([{ opens_at: '09:00', closes_at: '21:00' }]);
    expect(parseHours('14:00-20:00, 08:00-13:00')).toEqual([
      { opens_at: '08:00', closes_at: '13:00' },
      { opens_at: '14:00', closes_at: '20:00' },
    ]);
    expect(parseHours('closed')).toEqual([]);
  });
  it('rejects reversed, overlapping and malformed windows', () => {
    expect(parseHours('21:00-09:00')).toBeNull();
    expect(parseHours('09:00-14:00, 13:00-18:00')).toBeNull();
    expect(parseHours('9-18')).toBeNull();
  });
});

const minimal = {
  slug: 'demo-x',
  name: 'Студия',
  shortName: 'Студия',
  accentColor: '#4690ff',
  timezone: 'Europe/Moscow',
  contacts: { phone: '+7 900 111-22-33', address: 'Улица, 1' },
  images: { logo: 'images/logo.png', hero: 'images/hero.jpg' },
  infoCards: [
    { title: 'A', text: 'a' },
    { title: 'B', text: 'b' },
    { title: 'C', text: 'c' },
  ],
  resources: [{ key: 'box-1', name: 'Бокс 1' }],
  services: [{ key: 'wash', name: 'Мойка', price: 3500.5, duration: '1h 30m', buffer: '15m' }],
  hours: { mon: '09:00-21:00', tue: '09:00-21:00', wed: '09:00-21:00', thu: '09:00-21:00', fri: '09:00-21:00', sat: 'closed', sun: 'closed' },
  specialHours: [{ date: '2027-01-02', hours: '10:00-16:00' }],
  closedDates: [{ date: '2027-01-01', note: 'Новый год' }],
  works: [{ key: 'w1', image: 'images/works/1.jpg', caption: 'Работа' }],
};

describe('BusinessSchema', () => {
  it('accepts a minimal file and normalizes it for the database', () => {
    const b = BusinessSchema.parse(minimal);
    const cfg = normalizeBusiness(b, { logo_path: 'l', hero_path: 'h', works: { w1: 'p/w1.webp' } });
    expect(cfg.accent_color).toBe('#4690FF');
    expect(cfg.services[0]).toMatchObject({ price_minor: 350050, duration_minutes: 90, buffer_minutes: 15, resources: ['box-1'] });
    expect(cfg.hours).toHaveLength(5);
    expect(cfg.hours[0]).toEqual({ weekday: 1, opens_at: '09:00', closes_at: '21:00' });
    expect(cfg.exceptions).toEqual([
      { date: '2027-01-01', is_closed: true, note: 'Новый год' },
      { date: '2027-01-02', is_closed: false, opens_at: '10:00', closes_at: '16:00', note: null },
    ]);
    expect(cfg.photos).toEqual([{ key: 'w1', path: 'p/w1.webp', caption: 'Работа', sort: 10 }]);
    expect(cfg.booking.min_lead_minutes).toBe(120);
  });

  it('reports precise problems', () => {
    const bad = BusinessSchema.safeParse({
      ...minimal,
      timezone: 'Moscow',
      accentColor: 'blue',
      services: [{ ...minimal.services[0], resources: ['box-9'], duration: '5m' }],
      infoCards: minimal.infoCards.slice(0, 2),
    });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['timezone', 'accentColor', 'infoCards', 'services.0.resources', 'services.0.duration']));
  });
});
