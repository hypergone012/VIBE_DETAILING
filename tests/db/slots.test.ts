import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { anon, call, createTenant, newPool, resetRateLimits, su, uniqueSlug, type Envelope } from './helpers';

/**
 * Slot rules are evaluated with an explicit `now` (private.slot_candidates takes p_now),
 * so these tests pin the clock and check timezone and date boundaries exactly.
 */
let pool: pg.Pool;

beforeAll(async () => {
  pool = newPool();
  await resetRateLimits(pool);
});
afterAll(async () => {
  await pool.end();
});

interface Candidate {
  starts_at: Date;
  occupied_until: Date;
  local_date: string;
  local_time: string;
  free_resources?: number;
}

async function candidates(tenantId: string, serviceId: string, from: string, to: string, now: string, fn = 'slot_candidates') {
  return su<Candidate>(
    pool,
    `select starts_at, occupied_until, local_date::text, to_char(local_time, 'HH24:MI') as local_time
       ${fn === 'service_slots' ? ', free_resources' : ''}
     from private.${fn}($1, $2, $3::date, $4::date, $5::timestamptz)`,
    [tenantId, serviceId, from, to, now],
  );
}

describe('slot candidates', () => {
  it('uses working hours in the studio timezone, not UTC', async () => {
    const t = await createTenant(pool, uniqueSlug('tz'), {
      timezone: 'Asia/Yekaterinburg', // UTC+5
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: '10:00', closes_at: '12:00' })),
      booking: { slot_step_minutes: 30, min_lead_minutes: 0, horizon_days: 30 },
      services: [{ key: 'wash', name: 'Мойка', price_minor: 100000, duration_minutes: 60, resources: ['box-1'] }],
    });
    // Monday 2027-03-01; "now" = Sunday evening local.
    const rows = await candidates(t.tenantId, t.services.wash!, '2027-03-01', '2027-03-01', '2027-02-28T15:00:00Z');
    expect(rows.map((r) => r.local_time)).toEqual(['10:00', '10:30', '11:00']); // 11:30+60m would end after 12:00
    expect(rows[0]!.starts_at.toISOString()).toBe('2027-03-01T05:00:00.000Z'); // 10:00 at UTC+5
  });

  it('respects closed-day and special-hours exceptions', async () => {
    const t = await createTenant(pool, uniqueSlug('exc'), {
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '09:00', closes_at: '18:00' })),
      exceptions: [
        { date: '2027-03-02', is_closed: true, note: 'Санитарный день' },
        { date: '2027-03-03', is_closed: false, opens_at: '12:00', closes_at: '14:00' },
      ],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 100000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const now = '2027-02-27T00:00:00Z';
    expect(await candidates(t.tenantId, t.services.wash!, '2027-03-02', '2027-03-02', now)).toHaveLength(0);
    const special = await candidates(t.tenantId, t.services.wash!, '2027-03-03', '2027-03-03', now);
    expect(special.map((r) => r.local_time)).toEqual(['12:00', '12:30', '13:00']);
  });

  it('applies min lead time and the booking horizon', async () => {
    const t = await createTenant(pool, uniqueSlug('lead'), {
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '09:00', closes_at: '18:00' })),
      booking: { slot_step_minutes: 60, min_lead_minutes: 120, horizon_days: 2 },
      services: [{ key: 'wash', name: 'Мойка', price_minor: 100000, duration_minutes: 60, resources: ['box-1'] }],
    });
    // now = 2027-03-01 10:15 Moscow (07:15Z): first start ≥ 12:15 → 13:00.
    const today = await candidates(t.tenantId, t.services.wash!, '2027-03-01', '2027-03-01', '2027-03-01T07:15:00Z');
    expect(today[0]!.local_time).toBe('13:00');
    const beyond = await candidates(t.tenantId, t.services.wash!, '2027-03-04', '2027-03-05', '2027-03-01T07:15:00Z');
    expect(beyond).toHaveLength(0); // horizon_days = 2 → last date 2027-03-03
  });

  it('multi-day services hand the car back within working hours and skip closed hand-back days', async () => {
    const t = await createTenant(pool, uniqueSlug('multi'), {
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: '10:00', closes_at: '19:00' })), // Sat/Sun closed
      booking: { slot_step_minutes: 60, min_lead_minutes: 0, horizon_days: 30 },
      services: [
        { key: 'ceramic', name: 'Керамика', price_minor: 1000, duration_minutes: 2880, buffer_minutes: 60, resources: ['box-1'] },
      ],
    });
    const now = '2027-02-27T00:00:00Z';
    // Mon 2027-03-01 10:00 → handed back Wed 10:00: offered.
    const monday = await candidates(t.tenantId, t.services.ceramic!, '2027-03-01', '2027-03-01', now);
    expect(monday.map((r) => r.local_time)).toContain('10:00');
    expect(new Date(monday[0]!.occupied_until).toISOString()).toBe('2027-03-03T08:00:00.000Z'); // Wed 11:00 MSK incl. buffer
    // Thu 2027-03-04 → hand-back Saturday (closed): nothing offered.
    expect(await candidates(t.tenantId, t.services.ceramic!, '2027-03-04', '2027-03-04', now)).toHaveLength(0);
    // Fri 2027-03-05 → hand-back Sunday (closed): nothing offered.
    expect(await candidates(t.tenantId, t.services.ceramic!, '2027-03-05', '2027-03-05', now)).toHaveLength(0);
  });

  it('handles the DST-free zone and day boundaries crossing UTC midnight', async () => {
    const t = await createTenant(pool, uniqueSlug('midnight'), {
      timezone: 'Asia/Vladivostok', // UTC+10: local morning is the previous UTC day
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '08:00', closes_at: '10:00' })),
      booking: { slot_step_minutes: 60, min_lead_minutes: 0, horizon_days: 30 },
      services: [{ key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const rows = await candidates(t.tenantId, t.services.wash!, '2027-03-02', '2027-03-02', '2027-02-27T00:00:00Z');
    expect(rows.map((r) => r.local_date)).toEqual(['2027-03-02', '2027-03-02']);
    expect(rows[0]!.starts_at.toISOString()).toBe('2027-03-01T22:00:00.000Z');
  });

  it('marks a start busy when the occupancy range incl. buffer overlaps another booking', async () => {
    const t = await createTenant(pool, uniqueSlug('buf'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '09:00', closes_at: '18:00' })),
      booking: { slot_step_minutes: 30, min_lead_minutes: 0, horizon_days: 30 },
      services: [
        { key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 60, buffer_minutes: 30, resources: ['box-1'] },
      ],
    });
    await su(
      pool,
      `insert into public.resource_occupancies (tenant_id, resource_id, kind, during, note)
       values ($1, $2, 'block', tstzrange('2027-03-01 12:00+03', '2027-03-01 13:00+03', '[)'), 'test')`,
      [t.tenantId, t.resources['box-1']],
    );
    const rows = await candidates(t.tenantId, t.services.wash!, '2027-03-01', '2027-03-01', '2027-02-27T00:00:00Z', 'service_slots');
    const free = (time: string) => rows.find((r) => r.local_time === time)!.free_resources;
    expect(free('10:30')).toBe(1); // 10:30–12:00 incl. buffer ends exactly at block start
    expect(free('11:00')).toBe(0); // buffer 12:00–12:30 overlaps the block
    expect(free('12:30')).toBe(0);
    expect(free('13:00')).toBe(1);
  });
});

describe('public get_available_slots', () => {
  it('returns days with busy starts flagged, never other studios’ data', async () => {
    const t = await createTenant(pool, uniqueSlug('pub'));
    const res = await call<Envelope<{ days: Array<{ date: string; slots: Array<{ available: boolean }> }> }>>(
      pool,
      anon(),
      'select public.get_available_slots($1, $2, null, 3)',
      [t.slug, t.services.wash],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.days).toHaveLength(3);
    expect(res.days.some((d) => d.slots.length > 0)).toBe(true);

    const other = await createTenant(pool, uniqueSlug('pub-other'));
    const cross = await call<Envelope>(pool, anon(), 'select public.get_available_slots($1, $2, null, 3)', [
      other.slug,
      t.services.wash,
    ]);
    expect(cross).toMatchObject({ ok: false, error: 'service_not_found' });
  });
});
