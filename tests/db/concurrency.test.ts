import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  anon,
  call,
  createBooking,
  createOwner,
  createTenant,
  localStart,
  newPool,
  owner,
  resetRateLimits,
  su,
  uniqueSlug,
  type CreateResult,
  type Envelope,
} from './helpers';

/**
 * Real concurrency: each request runs on its own pooled connection in its own
 * transaction, all fired at once. The EXCLUDE constraint is the only arbiter.
 */
let pool: pg.Pool;

beforeAll(async () => {
  pool = newPool(40);
});
beforeEach(async () => {
  await resetRateLimits(pool);
});
afterAll(async () => {
  await pool.end();
});

const ip = (i: number) => `198.51.100.${100 + i}`;

describe('concurrent booking', () => {
  it('exactly one of 16 simultaneous clients gets a single-box slot', async () => {
    const t = await createTenant(pool, uniqueSlug('race1'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon(ip(i)))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'slot_taken')).toBe(true);
    const [{ n }] = await su<{ n: number }>(
      pool,
      `select count(*)::int n from public.resource_occupancies where tenant_id = $1 and released_at is null`,
      [t.tenantId],
    );
    expect(n).toBe(1);
  });

  it('with two suitable boxes exactly two of 16 simultaneous clients succeed, on different boxes', async () => {
    const t = await createTenant(pool, uniqueSlug('race2'));
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon(ip(i)))),
    );
    const ok = results.filter((r): r is { ok: true } & CreateResult => r.ok);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.booking.resource_name)).size).toBe(2);
  });

  it('overlapping (not identical) ranges race correctly', async () => {
    const t = await createTenant(pool, uniqueSlug('race3'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 90, resources: ['box-1'] }],
    });
    const starts = await Promise.all(['10:00', '10:30', '11:00', '11:30'].map((h) => localStart(pool, 'Europe/Moscow', 2, h)));
    const results = await Promise.all(
      starts.flatMap((s, i) => [0, 1].map((j) => createBooking(pool, t.slug, t.services.wash!, s, randomUUID(), anon(ip(i * 2 + j))))),
    );
    // 90-minute jobs from 10:00..11:30 in 30-min steps all overlap pairwise except 10:00 & 11:30.
    const ok = results.filter((r): r is { ok: true } & CreateResult => r.ok);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.length).toBeLessThanOrEqual(2);
    const [{ overlap_count: overlaps }] = await su<{ overlap_count: number }>(
      pool,
      `select count(*)::int as overlap_count from public.resource_occupancies a join public.resource_occupancies b
         on a.resource_id = b.resource_id and a.id < b.id and a.during && b.during
       where a.tenant_id = $1 and a.released_at is null and b.released_at is null`,
      [t.tenantId],
    );
    expect(overlaps).toBe(0);
  });

  it('the same idempotency key fired 10 times concurrently creates one booking and returns one token', async () => {
    const t = await createTenant(pool, uniqueSlug('idem'));
    const start = await localStart(pool, 'Europe/Moscow', 2, '12:00');
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createBooking(pool, t.slug, t.services.wash!, start, key, anon(ip(i)))),
    );
    const ok = results.filter((r): r is { ok: true } & CreateResult => r.ok);
    expect(ok).toHaveLength(10);
    expect(new Set(ok.map((r) => r.booking.code)).size).toBe(1);
    expect(new Set(ok.map((r) => r.access_token)).size).toBe(1);
    expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
    const [{ n }] = await su<{ n: number }>(pool, 'select count(*)::int n from public.bookings where idempotency_key = $1', [key]);
    expect(n).toBe(1);
  });

  it('concurrent reschedules of two bookings onto the same free slot: one wins, the other keeps its time', async () => {
    const t = await createTenant(pool, uniqueSlug('rrace'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const ownerId = await createOwner(pool, t.slug);
    const a = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    const b = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '12:00'));
    if (!a.ok || !b.ok) throw new Error('setup failed');
    const ids = await su<{ id: string; code: string; starts_at: Date }>(
      pool,
      'select id, code, starts_at from public.bookings where tenant_id = $1 order by starts_at',
      [t.tenantId],
    );
    const target = await localStart(pool, 'Europe/Moscow', 2, '16:00');
    const outcomes = await Promise.allSettled(
      ids.map((row) => call(pool, owner(ownerId), 'select public.owner_reschedule_booking($1, $2, $3)', [t.slug, row.id, target])),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const after = await su<{ starts_at: Date }>(pool, 'select starts_at from public.bookings where tenant_id = $1 order by code', [
      t.tenantId,
    ]);
    const atTarget = after.filter((r) => r.starts_at.toISOString() === target);
    expect(atTarget).toHaveLength(1);
  });

  it('owner manual booking and client booking race for one box: one wins', async () => {
    const t = await createTenant(pool, uniqueSlug('mixed'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 1000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const ownerId = await createOwner(pool, t.slug);
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const [client, manual] = await Promise.allSettled([
      createBooking(pool, t.slug, t.services.wash!, start),
      call(pool, owner(ownerId), 'select public.owner_create_booking($1, $2, $3, $4::jsonb, null, $5)', [
        t.slug,
        t.services.wash,
        start,
        JSON.stringify({ name: 'Пётр', phone: '+79001112233', car: 'Kia Rio' }),
        randomUUID(),
      ]),
    ]);
    const clientOk = client.status === 'fulfilled' && (client.value as Envelope).ok;
    const manualOk = manual.status === 'fulfilled';
    expect(Number(clientOk) + Number(manualOk)).toBe(1);
  });
});
