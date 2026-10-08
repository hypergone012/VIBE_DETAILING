import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  pgError,
  resetRateLimits,
  rows,
  service,
  su,
  uniqueSlug,
  type TenantFixture,
} from './helpers';

let pool: pg.Pool;
let a: TenantFixture;
let b: TenantFixture;
let ownerA: string;
let ownerB: string;
let tokenA: string;
let bookingA: string;

beforeAll(async () => {
  pool = newPool();
  await resetRateLimits(pool);
  a = await createTenant(pool, uniqueSlug('iso-a'));
  b = await createTenant(pool, uniqueSlug('iso-b'));
  ownerA = await createOwner(pool, a.slug);
  ownerB = await createOwner(pool, b.slug);
  const res = await createBooking(pool, a.slug, a.services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
  if (!res.ok) throw new Error('setup booking failed');
  tokenA = res.access_token;
  const [row] = await rows<{ id: string }>(pool, owner(ownerA), 'select id from public.bookings where code = $1', [
    res.booking.code,
  ]);
  bookingA = row!.id;
});
afterAll(async () => {
  await pool.end();
});

const TABLES = [
  'tenants',
  'tenant_members',
  'resources',
  'services',
  'service_resources',
  'working_hours',
  'schedule_exceptions',
  'tenant_photos',
  'bookings',
  'resource_occupancies',
  'booking_access_tokens',
  'payments',
  'booking_events',
  'push_subscriptions',
  'notification_jobs',
];

describe('anon has no direct table access', () => {
  for (const table of TABLES) {
    it(`anon cannot select public.${table}`, async () => {
      const err = await rows(pool, anon(), `select * from public.${table} limit 1`).catch(pgError);
      expect(err).toMatchObject({ code: '42501' });
    });
  }

  it('anon cannot write bookings or occupancies directly', async () => {
    const err = await rows(pool, anon(), `delete from public.bookings`).catch(pgError);
    expect(err).toMatchObject({ code: '42501' });
  });

  it('anon cannot reach private helpers, secrets or admin/worker RPCs', async () => {
    for (const sql of [
      'select * from private.app_secrets',
      `select private.booking_access_token('${randomUUID()}', '${randomUUID()}')`,
      `select public.admin_publish_tenant('{}'::jsonb, '{}'::jsonb)`,
      `select public.claim_notification_jobs('x', 1, 10)`,
      `select public.assistant_begin('x', 'client', '1.1.1.1', 1)`,
      `select public.owner_schedule('${a.slug}', 'today')`,
    ]) {
      const err = await rows(pool, anon(), sql).catch(pgError);
      expect(err.code, sql).toBe('42501');
    }
  });
});

describe('owner isolation', () => {
  it('an owner sees only their own studio rows', async () => {
    const bookings = await rows<{ tenant_id: string }>(pool, owner(ownerB), 'select tenant_id from public.bookings');
    expect(bookings.every((r) => r.tenant_id === b.tenantId)).toBe(true);
    const tenants = await rows<{ slug: string }>(pool, owner(ownerB), 'select slug from public.tenants');
    expect(tenants.map((r) => r.slug)).toEqual([b.slug]);
    const mine = await rows(pool, owner(ownerA), 'select id from public.bookings where id = $1', [bookingA]);
    expect(mine).toHaveLength(1);
  });

  it('owners never read access-token hashes', async () => {
    const err = await rows(pool, owner(ownerA), 'select * from public.booking_access_tokens').catch(pgError);
    expect(err).toMatchObject({ code: '42501' });
  });

  it("owner B cannot call owner RPCs on studio A, even with A's booking id", async () => {
    for (const [sql, params] of [
      ['select public.owner_schedule($1, $2)', [a.slug, 'this_week']],
      ['select public.owner_booking($1, $2)', [a.slug, bookingA]],
      ['select public.owner_cancel_booking($1, $2, null)', [a.slug, bookingA]],
      ['select public.owner_stats($1, $2)', [a.slug, 'this_month']],
      ['select public.owner_update_profile($1, $2::jsonb)', [a.slug, JSON.stringify({ name: 'Взлом' })]],
    ] as const) {
      const err = await call(pool, owner(ownerB), sql, [...params]).catch(pgError);
      expect(err, sql).toMatchObject({ code: 'PT403', message: 'forbidden' });
    }
  });

  it("owner B using their own slug cannot touch A's booking id", async () => {
    const err = await call(pool, owner(ownerB), 'select public.owner_cancel_booking($1, $2, null)', [b.slug, bookingA]).catch(pgError);
    expect(err).toMatchObject({ code: 'PT404' });
    const [row] = await rows<{ status: string }>(pool, owner(ownerA), 'select status from public.bookings where id = $1', [bookingA]);
    expect(row!.status).toBe('confirmed');
  });

  it('a service of studio A cannot be linked or booked through studio B', async () => {
    const err = await call(pool, owner(ownerB), 'select public.owner_create_booking($1, $2, $3, $4::jsonb, null, $5)', [
      b.slug,
      a.services.wash,
      await localStart(pool, 'Europe/Moscow', 3, '10:00'),
      JSON.stringify({ name: 'Х', phone: '+79001112233', car: 'Lada' }),
      randomUUID(),
    ]).catch(pgError);
    expect(err).toMatchObject({ code: 'PT422', message: 'service_unavailable' });
    // Composite FK: even a superuser cannot attach A's resource to B's service.
    const fk = await su(pool, 'insert into public.service_resources (tenant_id, service_id, resource_id) values ($1, $2, $3)', [
      b.tenantId,
      b.services.wash,
      a.resources['box-1'],
    ]).catch(pgError);
    expect(fk.code).toBe('23503');
    // And the service role has no direct table writes at all — only RPCs.
    const direct = await rows(pool, service, 'delete from public.bookings').catch(pgError);
    expect(direct.code).toBe('42501');
  });

  it('unauthenticated owner RPC calls are rejected', async () => {
    const err = await call(pool, { role: 'authenticated' }, 'select public.owner_session($1)', [a.slug]).catch(pgError);
    expect(err).toMatchObject({ code: 'PT401' });
  });
});

describe('client token scope', () => {
  it('a token only opens its own booking, and only under its own studio slug', async () => {
    expect(await call(pool, anon(), 'select public.get_booking($1, $2)', [a.slug, tokenA])).toMatchObject({ ok: true });
    expect(await call(pool, anon(), 'select public.get_booking($1, $2)', [b.slug, tokenA])).toMatchObject({
      ok: false,
      error: 'not_found',
    });
    expect(await call(pool, anon(), 'select public.get_booking($1, $2)', [a.slug, tokenA.slice(0, -1) + 'x'])).toMatchObject({
      ok: false,
    });
  });

  it('the public studio payload contains no personal data', async () => {
    const payload = JSON.stringify(await call(pool, anon(), 'select public.get_public_tenant($1)', [a.slug]));
    expect(payload).not.toContain('+79001234567');
    expect(payload).not.toContain('Иван');
    expect(payload).not.toContain('owner_overrides');
  });
});
