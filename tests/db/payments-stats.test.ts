import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  call,
  createBooking,
  createOwner,
  createTenant,
  localStart,
  newPool,
  owner,
  pgError,
  resetRateLimits,
  su,
  uniqueSlug,
  type TenantFixture,
} from './helpers';

let pool: pg.Pool;
let t: TenantFixture;
let ownerId: string;

beforeAll(async () => {
  pool = newPool();
  await resetRateLimits(pool);
  t = await createTenant(pool, uniqueSlug('money'));
  ownerId = await createOwner(pool, t.slug);
});
afterAll(async () => {
  await pool.end();
});

async function bookingId(code: string): Promise<string> {
  const [row] = await su<{ id: string }>(pool, 'select id from public.bookings where tenant_id = $1 and code = $2', [t.tenantId, code]);
  return row!.id;
}

const pay = (id: string, kind: 'payment' | 'refund', amount: number, key = randomUUID()) =>
  call<{ replayed: boolean; booking: { paid_minor: number; refunded_minor: number } }>(
    pool,
    owner(ownerId),
    'select public.owner_add_payment($1, $2, $3, $4, $5, $6, $7)',
    [t.slug, id, kind, amount, 'card', null, key],
  );

describe('payments', () => {
  it('records payments and refunds, refunds never exceed what was paid, retries are idempotent', async () => {
    const res = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    if (!res.ok) throw new Error('booking failed');
    const id = await bookingId(res.booking.code);

    const key = randomUUID();
    const p1 = await pay(id, 'payment', 200000, key);
    expect(p1.booking.paid_minor).toBe(200000);
    const p1again = await pay(id, 'payment', 200000, key);
    expect(p1again.replayed).toBe(true);
    expect(p1again.booking.paid_minor).toBe(200000);

    const tooMuch = await pay(id, 'refund', 250000).catch(pgError);
    expect(tooMuch).toMatchObject({ code: 'PT422', message: 'refund_exceeds_paid' });
    const r1 = await pay(id, 'refund', 50000);
    expect(r1.booking.refunded_minor).toBe(50000);

    const conflict = await call(pool, owner(ownerId), 'select public.owner_add_payment($1, $2, $3, $4, $5, $6, $7)', [
      t.slug,
      id,
      'payment',
      1,
      'cash',
      null,
      key,
    ]).catch(pgError);
    expect(conflict).toMatchObject({ code: 'PT409' });
  });

  it('concurrent refunds cannot jointly exceed the paid amount', async () => {
    const res = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '14:00'));
    if (!res.ok) throw new Error('booking failed');
    const id = await bookingId(res.booking.code);
    await pay(id, 'payment', 100000);
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => pay(id, 'refund', 60000)));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('statistics (SQL)', () => {
  it('separates visits, completed jobs, money received and the scheduled value', async () => {
    const s = await createTenant(pool, uniqueSlug('stats'));
    const sOwner = await createOwner(pool, s.slug);
    const statsBefore = await call<Record<string, number>>(pool, owner(sOwner), 'select public.owner_stats($1, $2)', [s.slug, 'today']);
    expect(statsBefore).toMatchObject({ visits: 0, completed: 0, received_minor: 0, scheduled_value_minor: 0 });

    // Today: one booking arrives and is completed and paid; one is only scheduled for later today.
    const now = await su<{ local: string }>(pool, `select to_char(now() at time zone 'Europe/Moscow', 'HH24:MI') as local`);
    const hour = Number(now[0]!.local.slice(0, 2));
    const laterToday = hour <= 21 ? `${String(hour + 1).padStart(2, '0')}:00` : null;

    const done = await call<{ booking: { id: string } }>(pool, owner(sOwner), 'select public.owner_create_booking($1, $2, $3, $4::jsonb, null, $5)', [
      s.slug,
      s.services.wash,
      new Date(Date.now() - 2 * 3600_000).toISOString(),
      JSON.stringify({ name: 'Анна', phone: '+79005554433', car: 'Mazda 6' }),
      randomUUID(),
    ]);
    await call(pool, owner(sOwner), 'select public.owner_set_status($1, $2, $3)', [s.slug, done.booking.id, 'arrived']);
    await call(pool, owner(sOwner), 'select public.owner_set_status($1, $2, $3)', [s.slug, done.booking.id, 'done']);
    await call(pool, owner(sOwner), 'select public.owner_add_payment($1, $2, $3, $4, $5, $6, $7)', [
      s.slug,
      done.booking.id,
      'payment',
      300000,
      'cash',
      null,
      randomUUID(),
    ]);
    if (laterToday) {
      const later = await localStart(pool, 'Europe/Moscow', 0, laterToday);
      await call(pool, owner(sOwner), 'select public.owner_create_booking($1, $2, $3, $4::jsonb, null, $5)', [
        s.slug,
        s.services.polish,
        later,
        JSON.stringify({ name: 'Олег', phone: '+79005554411', car: 'Audi A4' }),
        randomUUID(),
      ]);
    }

    const stats = await call<Record<string, number>>(pool, owner(sOwner), 'select public.owner_stats($1, $2)', [s.slug, 'today']);
    expect(stats.visits).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.received_minor).toBe(300000);
    expect(stats.net_received_minor).toBe(300000);
    // The scheduled polish is an expectation, never part of money received.
    expect(stats.scheduled_value_minor).toBe(laterToday ? 1500000 : 0);
    expect(stats.received_minor).not.toBe(stats.received_minor + stats.scheduled_value_minor - 1);
  });

  it('uses the studio timezone for period boundaries (same resolver as the assistant)', async () => {
    const [p] = await su<{ from_date: string; to_date: string; starts_at: Date; ends_at: Date }>(
      pool,
      `select from_date::text, to_date::text, starts_at, ends_at
       from private.resolve_period('Asia/Vladivostok', 'this_week', null, null, '2027-03-03T20:00:00Z')`,
    );
    // 2027-03-03 20:00Z = Thursday 06:00 in Vladivostok → week Mon 01 .. Sun 07.
    expect(p).toMatchObject({ from_date: '2027-03-01', to_date: '2027-03-07' });
    expect(p!.starts_at.toISOString()).toBe('2027-02-28T14:00:00.000Z');
    expect(p!.ends_at.toISOString()).toBe('2027-03-07T14:00:00.000Z');
  });

  it('marking a job done frees the rest of the box time (plus buffer)', async () => {
    const s = await createTenant(pool, uniqueSlug('early'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'polish', name: 'Полировка', price_minor: 1, duration_minutes: 240, buffer_minutes: 30, resources: ['box-1'] }],
    });
    const sOwner = await createOwner(pool, s.slug);
    const started = await call<{ booking: { id: string } }>(
      pool,
      owner(sOwner),
      'select public.owner_create_booking($1, $2, $3, $4::jsonb, null, $5)',
      [s.slug, s.services.polish, new Date(Date.now() - 3600_000).toISOString(), JSON.stringify({ name: 'А', phone: '+79001110000', car: 'VW' }), randomUUID()],
    );
    await call(pool, owner(sOwner), 'select public.owner_set_status($1, $2, $3)', [s.slug, started.booking.id, 'done']);
    const [occ] = await su<{ minutes_left: number }>(
      pool,
      `select round(extract(epoch from upper(during) - now()) / 60)::int as minutes_left
       from public.resource_occupancies where booking_id = $1 and released_at is null`,
      [started.booking.id],
    );
    expect(occ!.minutes_left).toBeLessThanOrEqual(30);
    // Undo restores the full range because nothing took the freed time.
    await call(pool, owner(sOwner), 'select public.owner_set_status($1, $2, $3)', [s.slug, started.booking.id, 'arrived']);
    const [full] = await su<{ minutes_left: number }>(
      pool,
      `select round(extract(epoch from upper(during) - now()) / 60)::int as minutes_left
       from public.resource_occupancies where booking_id = $1 and released_at is null`,
      [started.booking.id],
    );
    expect(full!.minutes_left).toBeGreaterThan(200);
  });
});
