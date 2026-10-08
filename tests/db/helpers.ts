import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * SQL integration test helpers. Tests run against the local Supabase Postgres
 * (supabase start) and emulate PostgREST exactly: each call runs in a transaction
 * with `SET LOCAL ROLE <anon|authenticated|service_role>` and `request.jwt.claims` /
 * `request.headers` GUCs, so RLS, grants and SECURITY DEFINER behave as in production.
 */
export const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Keep timestamps/numerics as strings: tests compare them explicitly.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function newPool(max = 20): pg.Pool {
  return new pg.Pool({ connectionString: DB_URL, max });
}

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface Caller {
  role: Role;
  userId?: string;
  ip?: string;
}

export const anon = (ip = '198.51.100.10'): Caller => ({ role: 'anon', ip });
export const owner = (userId: string, ip = '198.51.100.20'): Caller => ({ role: 'authenticated', userId, ip });
export const service: Caller = { role: 'service_role', ip: '203.0.113.5' };

/** Runs one statement as an API role inside its own transaction (like one PostgREST request). */
export async function call<T = unknown>(
  pool: pg.Pool,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${caller.role}`);
    const claims = caller.userId
      ? { sub: caller.userId, role: caller.role, aud: 'authenticated' }
      : { role: caller.role };
    await client.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
              set_config('request.headers', $3, true)`,
      [JSON.stringify(claims), caller.userId ?? '', JSON.stringify({ 'x-forwarded-for': caller.ip ?? '127.0.0.1' })],
    );
    const res = await client.query(sql, params);
    await client.query('commit');
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return (row ? Object.values(row)[0] : undefined) as T;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs a query and returns all rows (role-scoped). */
export async function rows<T = Record<string, unknown>>(
  pool: pg.Pool,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${caller.role}`);
    const claims = caller.userId ? { sub: caller.userId, role: caller.role } : { role: caller.role };
    await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`, [
      JSON.stringify(claims),
      JSON.stringify({ 'x-forwarded-for': caller.ip ?? '127.0.0.1' }),
    ]);
    const res = await client.query(sql, params);
    await client.query('commit');
    return res.rows as T[];
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Superuser query (fixtures, assertions on internal tables). */
export async function su<T = Record<string, unknown>>(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export interface TenantFixture {
  slug: string;
  tenantId: string;
  services: Record<string, string>;
  resources: Record<string, string>;
}

export interface TenantConfigOverrides {
  timezone?: string;
  hours?: Array<{ weekday: number; opens_at: string; closes_at: string }>;
  exceptions?: Array<{ date: string; is_closed?: boolean; opens_at?: string; closes_at?: string; note?: string }>;
  booking?: Partial<{ slot_step_minutes: number; min_lead_minutes: number; horizon_days: number; cancel_until_hours: number }>;
  resources?: Array<{ key: string; name: string; kind?: string; sort?: number }>;
  services?: Array<{
    key: string;
    name: string;
    price_minor: number;
    duration_minutes: number;
    buffer_minutes?: number;
    resources: string[];
    price_is_from?: boolean;
  }>;
  photos?: Array<{ key: string; path: string; caption?: string; sort?: number }>;
}

export const ALL_WEEK = (opens = '00:00', closes = '23:59') =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: opens, closes_at: closes }));

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function tenantConfig(slug: string, o: TenantConfigOverrides = {}) {
  return {
    slug,
    name: `Тестовая студия ${slug}`,
    short_name: 'Тест',
    tagline: 'Тестовый слоган',
    description: 'Описание для тестов',
    timezone: o.timezone ?? 'Europe/Moscow',
    currency: 'RUB',
    locale: 'ru-RU',
    accent_color: '#4690FF',
    contacts: {
      phone: '+7 900 000-00-00',
      phone_display: '+7 900 000-00-00',
      address: 'Тестовая улица, 1',
      address_note: 'Въезд со двора',
      map_url: 'https://example.com/map',
      geo: { lat: 55.75, lng: 37.61 },
    },
    media: { logo_path: null, hero_path: null, hero_alt: 'Машина' },
    info_cards: [
      { title: 'Один', text: 'Первая карточка', icon: 'sparkle' },
      { title: 'Два', text: 'Вторая карточка', icon: 'shield' },
      { title: 'Три', text: 'Третья карточка', icon: 'clock' },
    ],
    booking: { slot_step_minutes: 30, min_lead_minutes: 0, horizon_days: 60, cancel_until_hours: 12, ...o.booking },
    resources: o.resources ?? [
      { key: 'box-1', name: 'Бокс 1', kind: 'box', sort: 1 },
      { key: 'box-2', name: 'Бокс 2', kind: 'box', sort: 2 },
    ],
    services: o.services ?? [
      { key: 'wash', name: 'Мойка', price_minor: 300000, duration_minutes: 60, buffer_minutes: 15, resources: ['box-1', 'box-2'] },
      { key: 'polish', name: 'Полировка', price_minor: 1500000, duration_minutes: 240, buffer_minutes: 30, resources: ['box-1'] },
      { key: 'ceramic', name: 'Керамика', price_minor: 4500000, duration_minutes: 2880, buffer_minutes: 60, resources: ['box-1'] },
    ],
    hours: o.hours ?? ALL_WEEK(),
    exceptions: o.exceptions ?? [],
    photos: o.photos ?? [],
  };
}

export async function createTenant(
  pool: pg.Pool,
  slug: string,
  overrides: TenantConfigOverrides = {},
  options: Record<string, unknown> = {},
): Promise<TenantFixture> {
  const result = await call<{ tenant_id: string }>(
    pool,
    service,
    'select public.admin_publish_tenant($1::jsonb, $2::jsonb)',
    [JSON.stringify(tenantConfig(slug, overrides)), JSON.stringify(options)],
  );
  const tenantId = result.tenant_id;
  const services = Object.fromEntries(
    (await su<{ key: string; id: string }>(pool, 'select key, id from public.services where tenant_id = $1', [tenantId])).map(
      (r) => [r.key, r.id],
    ),
  );
  const resources = Object.fromEntries(
    (await su<{ key: string; id: string }>(pool, 'select key, id from public.resources where tenant_id = $1', [tenantId])).map(
      (r) => [r.key, r.id],
    ),
  );
  return { slug, tenantId, services, resources };
}

/** Creates an auth user (as GoTrue would) and makes them a member of the studio. */
export async function createOwner(pool: pg.Pool, slug: string): Promise<string> {
  const userId = randomUUID();
  await su(
    pool,
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                             raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
             extensions.crypt('test-password-123', extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now())`,
    [userId, `owner-${userId.slice(0, 8)}@example.test`],
  );
  await call(pool, service, 'select public.admin_add_member($1, $2)', [slug, userId]);
  return userId;
}

export async function makeTenantLive(pool: pg.Pool, slug: string, overrides: TenantConfigOverrides = {}): Promise<void> {
  await call(pool, service, 'select public.admin_publish_tenant($1::jsonb, $2::jsonb)', [
    JSON.stringify(tenantConfig(slug, overrides)),
    JSON.stringify({ activate: true }),
  ]);
}

export const customer = (overrides: Record<string, unknown> = {}) => ({
  name: 'Иван Тестов',
  phone: '8 (900) 123-45-67',
  car: 'BMW X5',
  plate: 'а123вс77',
  consent: true,
  ...overrides,
});

export type Envelope<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message: string; field?: string };

export interface PublicBooking {
  code: string;
  status: string;
  service_name: string;
  price_minor: number;
  starts_at: string;
  ends_at: string;
  resource_name: string;
  can_cancel: boolean;
  is_demo: boolean;
}

export interface CreateResult {
  replayed: boolean;
  access_token: string;
  booking: PublicBooking;
}

export function createBooking(
  pool: pg.Pool,
  slug: string,
  serviceId: string,
  startsAt: string,
  key: string = randomUUID(),
  caller: Caller = anon(),
  cust: Record<string, unknown> = customer(),
): Promise<Envelope<CreateResult>> {
  return call<Envelope<CreateResult>>(
    pool,
    caller,
    'select public.create_booking($1, $2, $3::timestamptz, $4::jsonb, $5::uuid)',
    [slug, serviceId, startsAt, JSON.stringify(cust), key],
  );
}

/** Next local date (in the studio timezone) at a given wall-clock time, N days ahead. */
export async function localStart(pool: pg.Pool, timezone: string, daysAhead: number, time: string): Promise<string> {
  const [row] = await su<{ ts: Date }>(
    pool,
    `select (((now() at time zone $1)::date + $2::int) + $3::time) at time zone $1 as ts`,
    [timezone, daysAhead, time],
  );
  return row!.ts.toISOString();
}

export async function resetRateLimits(pool: pg.Pool): Promise<void> {
  await su(pool, 'delete from private.rate_counters');
  await su(pool, 'delete from private.llm_usage_daily');
}

export function pgError(error: unknown): { code?: string; message?: string; hint?: string } {
  const e = error as { code?: string; message?: string; hint?: string };
  return { code: e.code, message: e.message, hint: e.hint };
}

/** Awaits a promise that must reject and returns the Postgres error details. */
export async function failure(promise: Promise<unknown>): Promise<{ code?: string; message?: string; hint?: string }> {
  try {
    await promise;
  } catch (error) {
    return pgError(error);
  }
  throw new Error('expected the statement to fail');
}
