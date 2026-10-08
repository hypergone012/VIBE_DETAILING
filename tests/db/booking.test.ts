import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  anon,
  call,
  createBooking,
  createOwner,
  createTenant,
  customer,
  localStart,
  newPool,
  owner,
  pgError,
  resetRateLimits,
  su,
  uniqueSlug,
  type Envelope,
  type TenantFixture,
} from './helpers';

let pool: pg.Pool;

beforeAll(async () => {
  pool = newPool();
});
beforeEach(async () => {
  await resetRateLimits(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('create_booking (client, no registration)', () => {
  let t: TenantFixture;
  beforeAll(async () => {
    t = await createTenant(pool, uniqueSlug('book'));
  });

  it('creates a booking with a server-side price/duration snapshot and a one-booking token', async () => {
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const res = await createBooking(pool, t.slug, t.services.wash!, start);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.price_minor).toBe(300000);
    expect(res.booking.status).toBe('confirmed');
    expect(res.booking.is_demo).toBe(true); // studio is still a preview
    expect(res.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Only the hash is stored.
    const [stored] = await su<{ token_hash: Buffer }>(
      pool,
      `select a.token_hash from public.booking_access_tokens a join public.bookings b on b.id = a.booking_id
       where b.tenant_id = $1 and b.code = $2`,
      [t.tenantId, res.booking.code],
    );
    expect(stored!.token_hash.toString('utf8')).not.toContain(res.access_token);
    const [{ matches }] = await su<{ matches: boolean }>(pool, `select private.token_hash($1) = $2 as matches`, [
      res.access_token,
      stored!.token_hash,
    ]);
    expect(matches).toBe(true);

    const viaToken = await call<Envelope<{ booking: { code: string } }>>(pool, anon(), 'select public.get_booking($1, $2)', [
      t.slug,
      res.access_token,
    ]);
    expect(viaToken).toMatchObject({ ok: true, booking: { code: res.booking.code } });
  });

  it('ignores any client-sent price, tenant or duration', async () => {
    const start = await localStart(pool, 'Europe/Moscow', 2, '12:00');
    const res = await createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon(), {
      ...customer(),
      price_minor: 1,
      duration_minutes: 1,
      tenant_id: randomUUID(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.price_minor).toBe(300000);
    const [b] = await su<{ duration_minutes: number; tenant_id: string }>(
      pool,
      'select duration_minutes, tenant_id from public.bookings where code = $1 and tenant_id = $2',
      [res.booking.code, t.tenantId],
    );
    expect(b).toEqual({ duration_minutes: 60, tenant_id: t.tenantId });
  });

  it('is idempotent: a retry returns the same booking and the same token', async () => {
    const start = await localStart(pool, 'Europe/Moscow', 3, '10:00');
    const key = randomUUID();
    const first = await createBooking(pool, t.slug, t.services.wash!, start, key);
    const retry = await createBooking(pool, t.slug, t.services.wash!, start, key);
    expect(first.ok && retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(retry.replayed).toBe(true);
    expect(retry.booking.code).toBe(first.booking.code);
    expect(retry.access_token).toBe(first.access_token);
    const [{ n }] = await su<{ n: number }>(pool, 'select count(*)::int n from public.bookings where idempotency_key = $1', [key]);
    expect(n).toBe(1);
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    const key = randomUUID();
    const first = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 4, '10:00'), key);
    expect(first.ok).toBe(true);
    const other = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 4, '14:00'), key);
    expect(other).toMatchObject({ ok: false, error: 'idempotency_conflict' });
  });

  it('validates input and the offered slot grid', async () => {
    const start = await localStart(pool, 'Europe/Moscow', 5, '10:00');
    expect(await createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon(), customer({ phone: '123' }))).toMatchObject({
      ok: false,
      error: 'invalid_input',
      field: 'phone',
    });
    expect(await createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon(), customer({ consent: false }))).toMatchObject({
      ok: false,
      field: 'consent',
    });
    const offGrid = await localStart(pool, 'Europe/Moscow', 5, '10:10');
    expect(await createBooking(pool, t.slug, t.services.wash!, offGrid)).toMatchObject({ ok: false, error: 'slot_not_offered' });
    const past = new Date(Date.now() - 3600_000).toISOString();
    expect(await createBooking(pool, t.slug, t.services.wash!, past)).toMatchObject({ ok: false, error: 'slot_not_offered' });
  });
});

describe('resources and occupancy', () => {
  it('fills two suitable resources, then reports the slot as taken', async () => {
    const t = await createTenant(pool, uniqueSlug('two'));
    const start = await localStart(pool, 'Europe/Moscow', 2, '11:00');
    const a = await createBooking(pool, t.slug, t.services.wash!, start);
    const b = await createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon('198.51.100.11'));
    const c = await createBooking(pool, t.slug, t.services.wash!, start, randomUUID(), anon('198.51.100.12'));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(new Set([a.booking.resource_name, b.booking.resource_name])).toEqual(new Set(['Бокс 1', 'Бокс 2']));
    expect(c).toMatchObject({ ok: false, error: 'slot_taken' });
  });

  it('a two-day service occupies its box across both days', async () => {
    const t = await createTenant(pool, uniqueSlug('multi'));
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const ceramic = await createBooking(pool, t.slug, t.services.ceramic!, start);
    expect(ceramic.ok).toBe(true);
    // Polish needs box-1 only; next day at noon is inside the 2-day occupancy.
    const nextDayNoon = await localStart(pool, 'Europe/Moscow', 3, '12:00');
    expect(await createBooking(pool, t.slug, t.services.polish!, nextDayNoon)).toMatchObject({ ok: false, error: 'slot_taken' });
    // Wash can still use box-2.
    expect((await createBooking(pool, t.slug, t.services.wash!, nextDayNoon)).ok).toBe(true);
    // After hand-back (+48h) + 60 min buffer, box-1 is free again.
    const afterBuffer = await localStart(pool, 'Europe/Moscow', 4, '11:00');
    expect((await createBooking(pool, t.slug, t.services.polish!, afterBuffer)).ok).toBe(true);
    const insideBuffer = await localStart(pool, 'Europe/Moscow', 4, '10:30');
    expect(await createBooking(pool, t.slug, t.services.polish!, insideBuffer)).toMatchObject({ ok: false, error: 'slot_taken' });
  });

  it('owner blocks and bookings exclude each other on the same resource', async () => {
    const t = await createTenant(pool, uniqueSlug('block'));
    const ownerId = await createOwner(pool, t.slug);
    const start = await localStart(pool, 'Europe/Moscow', 2, '10:00');
    const end = await localStart(pool, 'Europe/Moscow', 2, '16:00');
    const block = await call<{ id: string }>(pool, owner(ownerId), 'select public.owner_create_block($1, $2, $3, $4, $5)', [
      t.slug,
      t.resources['box-1'],
      start,
      end,
      'Ремонт подъёмника',
    ]);
    expect(block.id).toBeTruthy();
    // Polish only fits box-1 → taken.
    expect(await createBooking(pool, t.slug, t.services.polish!, await localStart(pool, 'Europe/Moscow', 2, '11:00'))).toMatchObject({
      ok: false,
      error: 'slot_taken',
    });
    // A booking first, then a block over it → 409.
    const booked = await createBooking(pool, t.slug, t.services.polish!, await localStart(pool, 'Europe/Moscow', 3, '10:00'));
    expect(booked.ok).toBe(true);
    await expect(
      call(pool, owner(ownerId), 'select public.owner_create_block($1, $2, $3, $4, null)', [
        t.slug,
        t.resources['box-1'],
        await localStart(pool, 'Europe/Moscow', 3, '09:00'),
        await localStart(pool, 'Europe/Moscow', 3, '12:00'),
      ]),
    ).rejects.toMatchObject({ code: 'PT409' });
    // Releasing the block frees the time.
    await call(pool, owner(ownerId), 'select public.owner_release_block($1, $2)', [t.slug, block.id]);
    expect((await createBooking(pool, t.slug, t.services.polish!, await localStart(pool, 'Europe/Moscow', 2, '11:00'))).ok).toBe(true);
  });
});

describe('reschedule and cancel', () => {
  it('reschedules atomically and keeps the original booking when the new time is taken', async () => {
    const t = await createTenant(pool, uniqueSlug('resch'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 300000, duration_minutes: 60, buffer_minutes: 0, resources: ['box-1'] }],
    });
    const ownerId = await createOwner(pool, t.slug);
    const a = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    const b = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '13:00'));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const [{ id: aId }] = await su<{ id: string }>(pool, 'select id from public.bookings where tenant_id=$1 and code=$2', [
      t.tenantId,
      a.booking.code,
    ]);

    // Overlapping shift of itself (10:00 → 10:30) works: its own old occupancy is released first.
    const moved = await call<{ changed: boolean; booking: { starts_at: string } }>(
      pool,
      owner(ownerId),
      'select public.owner_reschedule_booking($1, $2, $3)',
      [t.slug, aId, await localStart(pool, 'Europe/Moscow', 2, '10:30')],
    );
    expect(moved.changed).toBe(true);

    // Moving onto booking B fails and leaves A exactly as it was.
    const before = await su(pool, 'select starts_at, resource_id from public.bookings where id = $1', [aId]);
    const occBefore = await su(pool, 'select during from public.resource_occupancies where booking_id=$1 and released_at is null', [aId]);
    const err = await call(pool, owner(ownerId), 'select public.owner_reschedule_booking($1, $2, $3)', [
      t.slug,
      aId,
      await localStart(pool, 'Europe/Moscow', 2, '13:30'),
    ]).catch(pgError);
    expect(err).toMatchObject({ code: 'PT409', message: 'slot_taken' });
    expect(await su(pool, 'select starts_at, resource_id from public.bookings where id = $1', [aId])).toEqual(before);
    expect(await su(pool, 'select during from public.resource_occupancies where booking_id=$1 and released_at is null', [aId])).toEqual(
      occBefore,
    );

    // Repeating the same reschedule is a no-op.
    const again = await call<{ changed: boolean }>(pool, owner(ownerId), 'select public.owner_reschedule_booking($1, $2, $3)', [
      t.slug,
      aId,
      await localStart(pool, 'Europe/Moscow', 2, '10:30'),
    ]);
    expect(again.changed).toBe(false);
  });

  it('client cancels within the window (idempotent) and the slot becomes free', async () => {
    const t = await createTenant(pool, uniqueSlug('cancel'), {
      resources: [{ key: 'box-1', name: 'Бокс 1' }],
      services: [{ key: 'wash', name: 'Мойка', price_minor: 300000, duration_minutes: 60, resources: ['box-1'] }],
    });
    const start = await localStart(pool, 'Europe/Moscow', 3, '10:00');
    const res = await createBooking(pool, t.slug, t.services.wash!, start);
    if (!res.ok) throw new Error('booking failed');
    const c1 = await call<Envelope<{ booking: { status: string } }>>(pool, anon(), 'select public.cancel_booking($1, $2, $3)', [
      t.slug,
      res.access_token,
      'Планы поменялись',
    ]);
    expect(c1).toMatchObject({ ok: true, booking: { status: 'cancelled' } });
    const c2 = await call<Envelope>(pool, anon(), 'select public.cancel_booking($1, $2, null)', [t.slug, res.access_token]);
    expect(c2).toMatchObject({ ok: true });
    expect((await createBooking(pool, t.slug, t.services.wash!, start)).ok).toBe(true);
  });

  it('client cannot cancel after the studio’s cancellation deadline', async () => {
    const t = await createTenant(pool, uniqueSlug('late'), { booking: { cancel_until_hours: 48, min_lead_minutes: 0 } });
    const res = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 1, '23:00'));
    if (!res.ok) throw new Error('booking failed');
    expect(res.booking.can_cancel).toBe(false);
    expect(await call(pool, anon(), 'select public.cancel_booking($1, $2, null)', [t.slug, res.access_token])).toMatchObject({
      ok: false,
      error: 'cancel_window_closed',
    });
  });
});

describe('historical price', () => {
  it('keeps the booked price after the owner changes the service price', async () => {
    const t = await createTenant(pool, uniqueSlug('price'));
    const ownerId = await createOwner(pool, t.slug);
    const res = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    if (!res.ok) throw new Error('booking failed');
    await call(pool, owner(ownerId), 'select public.owner_upsert_service($1, $2::jsonb)', [
      t.slug,
      JSON.stringify({ id: t.services.wash, name: 'Мойка', price_minor: 990000, duration_minutes: 90, resource_ids: [t.resources['box-1']] }),
    ]);
    const after = await call<Envelope<{ booking: { price_minor: number; duration_minutes: number } }>>(
      pool,
      anon(),
      'select public.get_booking($1, $2)',
      [t.slug, res.access_token],
    );
    expect(after).toMatchObject({ ok: true, booking: { price_minor: 300000, duration_minutes: 60 } });
    const next = await createBooking(pool, t.slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '15:00'));
    expect(next).toMatchObject({ ok: true, booking: { price_minor: 990000 } });
  });
});
