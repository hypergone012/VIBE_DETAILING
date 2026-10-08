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
  pgError,
  resetRateLimits,
  service,
  su,
  tenantConfig,
  uniqueSlug,
  type Envelope,
} from './helpers';

let pool: pg.Pool;

beforeAll(async () => {
  pool = newPool(30);
});
beforeEach(async () => {
  await resetRateLimits(pool);
});
afterAll(async () => {
  await pool.end();
});

const publish = (config: unknown, options: Record<string, unknown> = {}) =>
  call<{ status: string; config_version: number; purged_demo_bookings: number; skipped: unknown[]; created: boolean }>(
    pool,
    service,
    'select public.admin_publish_tenant($1::jsonb, $2::jsonb)',
    [JSON.stringify(config), JSON.stringify(options)],
  );

describe('tenant pipeline (admin_publish_tenant)', () => {
  it('a second studio is created next to the first, never replacing it', async () => {
    const one = await createTenant(pool, uniqueSlug('first'));
    const two = await createTenant(pool, uniqueSlug('second'));
    expect(one.tenantId).not.toBe(two.tenantId);
    expect(await call(pool, anon(), 'select public.get_public_tenant($1)', [one.slug])).toMatchObject({ ok: true });
    expect(await call(pool, anon(), 'select public.get_public_tenant($1)', [two.slug])).toMatchObject({ ok: true });
  });

  it('republishing keeps bookings, owner edits and owner photos; removed config rows are deactivated', async () => {
    const slug = uniqueSlug('repub');
    const cfg = tenantConfig(slug, {
      photos: [
        { key: 'p1', path: 'x/config/p1.webp', caption: 'Первое', sort: 1 },
        { key: 'p2', path: 'x/config/p2.webp', caption: 'Второе', sort: 2 },
      ],
    });
    await publish(cfg);
    const [{ id: tenantId }] = await su<{ id: string }>(pool, 'select id from public.tenants where slug = $1', [slug]);
    const ownerId = await createOwner(pool, slug);
    const services = Object.fromEntries(
      (await su<{ key: string; id: string }>(pool, 'select key, id from public.services where tenant_id = $1', [tenantId])).map((r) => [r.key, r.id]),
    );
    const booking = await createBooking(pool, slug, services.wash!, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    expect(booking.ok).toBe(true);

    // Owner edits: name, one service price, one photo caption; uploads a new photo.
    await call(pool, owner(ownerId), 'select public.owner_update_profile($1, $2::jsonb)', [slug, JSON.stringify({ name: 'Имя от владельца' })]);
    await call(pool, owner(ownerId), 'select public.owner_upsert_service($1, $2::jsonb)', [
      slug,
      JSON.stringify({ id: services.polish, name: 'Полировка PRO', price_minor: 2000000, duration_minutes: 240 }),
    ]);
    const [p2] = await su<{ id: string }>(pool, `select id from public.tenant_photos where tenant_id = $1 and key = 'p2'`, [tenantId]);
    await call(pool, owner(ownerId), 'select public.owner_set_photo_caption($1, $2, $3)', [slug, p2!.id, 'Подпись владельца']);
    const ownerPath = `${tenantId}/owner/${randomUUID()}.webp`;
    await su(pool, `insert into storage.objects (bucket_id, name) values ('tenant-media', $1)`, [ownerPath]);
    await call(pool, owner(ownerId), 'select public.owner_add_photo($1, $2, $3)', [slug, ownerPath, 'Новая работа']);

    // Republish a changed config: new tagline/price, the "ceramic" service removed.
    const next = {
      ...cfg,
      name: 'Имя из конфига v2',
      tagline: 'Новый слоган',
      services: cfg.services.filter((s) => s.key !== 'ceramic').map((s) => (s.key === 'wash' ? { ...s, price_minor: 350000 } : s)),
      photos: [...cfg.photos, { key: 'p3', path: 'x/config/p3.webp', caption: 'Третье', sort: 3 }],
    };
    const res = await publish(next);
    expect(res.config_version).toBe(2);

    const [tenant] = await su<{ name: string; tagline: string }>(pool, 'select name, tagline from public.tenants where id = $1', [tenantId]);
    expect(tenant).toEqual({ name: 'Имя от владельца', tagline: 'Новый слоган' });
    const svc = await su<{ key: string; price_minor: number; name: string; is_active: boolean }>(
      pool,
      'select key, price_minor, name, is_active from public.services where tenant_id = $1 order by key',
      [tenantId],
    );
    expect(svc).toEqual([
      { key: 'ceramic', price_minor: 4500000, name: 'Керамика', is_active: false },
      { key: 'polish', price_minor: 2000000, name: 'Полировка PRO', is_active: true },
      { key: 'wash', price_minor: 350000, name: 'Мойка', is_active: true },
    ]);
    const photos = await su<{ key: string | null; caption: string; origin: string }>(
      pool,
      'select key, caption, origin from public.tenant_photos where tenant_id = $1 and is_active order by sort',
      [tenantId],
    );
    expect(photos).toEqual([
      { key: 'p1', caption: 'Первое', origin: 'config' },
      { key: 'p2', caption: 'Подпись владельца', origin: 'config' },
      { key: 'p3', caption: 'Третье', origin: 'config' },
      { key: null, caption: 'Новая работа', origin: 'owner' }, // appended after existing cards
    ]);
    const [{ n }] = await su<{ n: number }>(pool, 'select count(*)::int n from public.bookings where tenant_id = $1', [tenantId]);
    expect(n).toBe(1);
  });

  it('activation requires business data and purges demo bookings made during preview', async () => {
    const slug = uniqueSlug('golive');
    const cfg = tenantConfig(slug);
    await publish({ ...cfg, contacts: { ...cfg.contacts, phone: null } });
    const fail = await publish({ ...cfg, contacts: { ...cfg.contacts, phone: null } }, { activate: true }).catch(pgError);
    expect(fail).toMatchObject({ code: 'PT422', message: 'not_ready' });

    await publish(cfg);
    const [{ id: tenantId }] = await su<{ id: string }>(pool, 'select id from public.tenants where slug = $1', [slug]);
    const [{ id: wash }] = await su<{ id: string }>(pool, `select id from public.services where tenant_id = $1 and key = 'wash'`, [tenantId]);
    const demo = await createBooking(pool, slug, wash, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    expect(demo).toMatchObject({ ok: true, booking: { is_demo: true } });

    const live = await publish(cfg, { activate: true });
    expect(live).toMatchObject({ status: 'live', purged_demo_bookings: 1 });
    const real = await createBooking(pool, slug, wash, await localStart(pool, 'Europe/Moscow', 2, '10:00'));
    expect(real).toMatchObject({ ok: true, booking: { is_demo: false } });
    // Republishing a live studio keeps it live and keeps real bookings.
    expect(await publish(cfg)).toMatchObject({ status: 'live', purged_demo_bookings: 0 });
  });

  it('rejects an invalid config before touching data', async () => {
    const bad = await publish({ ...tenantConfig(uniqueSlug('bad')), timezone: 'Mars/Olympus' }).catch(pgError);
    expect(bad).toMatchObject({ code: 'PT422', message: 'invalid_config' });
    const badSlug = await publish({ ...tenantConfig('x'), slug: 'Bad Slug!' }).catch(pgError);
    expect(badSlug).toMatchObject({ code: 'PT422' });
  });
});

describe('shared atomic counters', () => {
  it('rate limit counters are atomic under concurrency and saturate at the limit', async () => {
    await su(pool, `update private.app_config set value = '5' where key = 'rate.token_ip_per_10min'`);
    try {
      const t = await createTenant(pool, uniqueSlug('rl'));
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => call<Envelope>(pool, anon('192.0.2.77'), 'select public.get_booking($1, $2)', [t.slug, 'x'.repeat(43)])),
      );
      const limited = results.filter((r) => r.status === 'rejected' && pgError(r.reason).code === 'PT429');
      expect(results.length - limited.length).toBe(5);
      // A different IP is unaffected.
      expect(await call(pool, anon('192.0.2.78'), 'select public.get_booking($1, $2)', [t.slug, 'y'.repeat(43)])).toMatchObject({ ok: false });
    } finally {
      await su(pool, `update private.app_config set value = '60' where key = 'rate.token_ip_per_10min'`);
    }
  });

  it('failed booking attempts still count towards the IP limit (envelope errors commit)', async () => {
    const t = await createTenant(pool, uniqueSlug('rl2'));
    for (let i = 0; i < 10; i += 1) {
      await call(pool, anon('192.0.2.90'), 'select public.create_booking($1, $2, now(), $3::jsonb, $4)', [
        t.slug,
        t.services.wash,
        JSON.stringify({ name: 'x' }),
        randomUUID(),
      ]);
    }
    const err = await call(pool, anon('192.0.2.90'), 'select public.create_booking($1, $2, now(), $3::jsonb, $4)', [
      t.slug,
      t.services.wash,
      '{}',
      randomUUID(),
    ]).catch(pgError);
    expect(err).toMatchObject({ code: 'PT429', message: 'rate_limited' });
  });

  it('LLM budget: concurrent reservations never exceed the tenant daily budget', async () => {
    const t = await createTenant(pool, uniqueSlug('llm'));
    await su(pool, `update private.app_config set value = '10000' where key = 'llm.tenant_daily_tokens'`);
    await su(pool, `update private.app_config set value = '1000' where key = 'rate.assistant_ip_per_10min'`);
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          call<Envelope<{ reserved_tokens: number }>>(pool, service, 'select public.assistant_begin($1, $2, $3, $4)', [
            t.slug,
            'client',
            `203.0.113.${i}`,
            2000,
          ]),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'budget_exhausted')).toBe(true);
      const [usage] = await su<{ tokens: number; requests: number }>(
        pool,
        `select tokens, requests from private.llm_usage_daily where scope_key = $1`,
        [`tenant:${t.tenantId}`],
      );
      expect(usage).toEqual({ tokens: 10000, requests: 5 });
      // Reconciliation with the real usage frees budget.
      await call(pool, service, 'select public.assistant_finish($1, $2, $3)', [t.tenantId, 2000, 500]);
      const [after] = await su<{ tokens: number }>(pool, `select tokens from private.llm_usage_daily where scope_key = $1`, [
        `tenant:${t.tenantId}`,
      ]);
      expect(after!.tokens).toBe(8500);
    } finally {
      await su(pool, `update private.app_config set value = '200000' where key = 'llm.tenant_daily_tokens'`);
      await su(pool, `update private.app_config set value = '20' where key = 'rate.assistant_ip_per_10min'`);
    }
  });

  it('assistant per-IP rate limit', async () => {
    const t = await createTenant(pool, uniqueSlug('llm-ip'));
    await su(pool, `update private.app_config set value = '3' where key = 'rate.assistant_ip_per_10min'`);
    try {
      const out: Envelope[] = [];
      for (let i = 0; i < 5; i += 1) {
        out.push(await call<Envelope>(pool, service, 'select public.assistant_begin($1, $2, $3, $4)', [t.slug, 'client', '203.0.113.200', 10]));
      }
      expect(out.map((r) => r.ok)).toEqual([true, true, true, false, false]);
      expect(out[3]).toMatchObject({ error: 'rate_limited' });
    } finally {
      await su(pool, `update private.app_config set value = '20' where key = 'rate.assistant_ip_per_10min'`);
    }
  });
});
