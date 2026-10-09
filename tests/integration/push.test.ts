import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ece from 'http_ece';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleDispatch } from '../../supabase/functions/_shared/push/dispatch.ts';
import { b64urlDecode, b64urlEncode, generateVapidKeys, type VapidKeys } from '../../supabase/functions/_shared/push/webpush.ts';
import {
  anon,
  call,
  createBooking,
  createOwner,
  createTenant,
  DB_URL,
  makeTenantLive,
  owner,
  resetRateLimits,
  su,
  uniqueSlug,
  type CreateResult,
  type Envelope,
} from '../db/helpers.ts';
import { apiEnv } from './env.ts';

/**
 * Reminders end to end without a real browser push service: real outbox in
 * Postgres, the dispatch handler (WebCrypto Web Push), and a fake push service
 * on 127.0.0.1 that answers like FCM/Mozilla/Apple. Each delivered message is
 * decrypted with the reference http_ece library, as a browser would.
 */
interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
const received: Received[] = [];
const browsers = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();
let server: Server;
let base = '';
let vapid: VapidKeys;
let slug = '';
let serviceId = '';
let ownerId = '';
const SECRET = 'test-dispatch-secret';

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
    const kind = (req.url ?? '').split('/')[1];
    res.writeHead(kind === 'gone' ? 410 : kind === 'busy' ? 503 : 201).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vapid = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.test' };

  await su(pool, `update private.app_config set value = 'true' where key = 'push.allow_insecure_test_endpoints'`);
  // Only this file's jobs may be due: leftovers from other suites must not reach real push services.
  await su(pool, `update public.notification_jobs set status = 'cancelled', last_error = 'test_isolation' where status in ('pending', 'processing')`);

  slug = uniqueSlug('push');
  const tenant = await createTenant(pool, slug);
  await makeTenantLive(pool, slug);
  serviceId = tenant.services.wash!;
  ownerId = await createOwner(pool, slug);
});

afterAll(async () => {
  await su(pool, `update private.app_config set value = 'false' where key = 'push.allow_insecure_test_endpoints'`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  received.length = 0;
  await resetRateLimits(pool);
});

// Every booking gets its own hour (5h, 6h, …): the test studio has two boxes.
let nextHour = 5;
async function newBooking(_hint: number, studio = slug, service = serviceId, startsAt?: string) {
  const [row] = await su<{ ts: Date }>(pool, `select date_trunc('hour', now()) + make_interval(hours => $1) as ts`, [nextHour++]);
  const res = (await createBooking(pool, studio, service, startsAt ?? row!.ts.toISOString())) as Envelope<CreateResult>;
  if (!res.ok) throw new Error(`booking failed: ${res.error}`);
  return res;
}

async function subscribe(booking: { access_token: string }, kind: 'ok' | 'gone' | 'busy', studio = slug) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `${base}/${kind}/${randomUUID()}`;
  browsers.set(endpoint, { ecdh, auth });
  const result = await call<Record<string, unknown>>(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [
    studio,
    booking.access_token,
    JSON.stringify({ endpoint, keys: { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) } }),
  ]);
  return { endpoint, result };
}

async function dispatch(secret = SECRET, keys: VapidKeys | null = vapid) {
  const env = apiEnv();
  const res = await handleDispatch(new Request('http://edge.local/functions/v1/notifications-dispatch', { method: 'POST', headers: { 'x-dispatch-secret': secret } }), {
    supabaseUrl: env.supabaseUrl,
    serviceKey: env.serviceKey,
    dispatchSecret: SECRET,
    vapid: keys,
  });
  return { status: res.status, body: (await res.json()) as Record<string, number | string> };
}

const jobsOf = (code: string) =>
  su<{ status: string; last_error: string | null; attempts: number; run_at: Date; dedupe_key: string }>(
    pool,
    `select j.status, j.last_error, j.attempts, j.run_at, j.dedupe_key from public.notification_jobs j
       join public.bookings b on b.id = j.booking_id where b.code = $1 order by j.created_at`,
    [code],
  );
const hits = (endpoint: string) => received.filter((r) => `${base}${r.path}` === endpoint);

describe('reminder delivery', () => {
  it('encrypts the reminder for the browser, signs with VAPID and marks the job sent once', async () => {
    const booking = await newBooking(5);
    const { endpoint, result } = await subscribe(booking, 'ok');
    expect(result).toMatchObject({ ok: true, state: 'scheduled' });

    const run = await dispatch();
    expect(run.status).toBe(200);
    const [msg] = hits(endpoint);
    expect(msg).toBeDefined();
    expect(msg!.headers['content-encoding']).toBe('aes128gcm');
    expect(Number(msg!.headers.ttl)).toBeGreaterThan(0);

    // VAPID: JWT for this push service origin, verifiable with our public key.
    const [, token, k] = String(msg!.headers.authorization).match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(vapid.publicKey);
    const [h, c, s] = token!.split('.');
    expect(JSON.parse(Buffer.from(b64urlDecode(c!)).toString()).aud).toBe(base);
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s!), new TextEncoder().encode(`${h}.${c}`))).toBe(true);

    // The browser side: decrypt with the subscription keys.
    const browser = browsers.get(endpoint)!;
    const payload = JSON.parse(ece.decrypt(msg!.body, { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: browser.auth }).toString());
    expect(payload).toMatchObject({ url: `/s/${slug}/my/${booking.booking.code}`, tag: `reminder-${booking.booking.code}` });
    expect(payload.body).toContain(booking.booking.code);
    expect(payload.title).toMatch(/^Напоминание/);

    expect((await jobsOf(booking.booking.code)).map((j) => j.status)).toEqual(['sent']);
    // Dedupe: the next run does not send it again.
    received.length = 0;
    await dispatch();
    expect(hits(endpoint)).toHaveLength(0);
  });

  it('two dispatchers running at once deliver each reminder exactly once (lease)', async () => {
    const endpoints: string[] = [];
    for (let i = 0; i < 3; i++) endpoints.push((await subscribe(await newBooking(6 + i), 'ok')).endpoint);
    await Promise.all([dispatch(), dispatch(), dispatch()]);
    for (const e of endpoints) expect(hits(e)).toHaveLength(1);
  });
});

describe('reschedule and cancellation', () => {
  it('a reschedule replaces the reminder: the old one is cancelled, the new one waits for its time', async () => {
    const booking = await newBooking(5);
    const { endpoint } = await subscribe(booking, 'ok');
    const [bk] = await su<{ id: string }>(pool, 'select id from public.bookings where code = $1', [booking.booking.code]);
    const [target] = await su<{ ts: Date }>(pool, `select date_trunc('hour', now()) + interval '3 days' as ts`);
    await call(pool, owner(ownerId), 'select public.owner_reschedule_booking($1, $2, $3::timestamptz)', [slug, bk!.id, target!.ts.toISOString()]);

    const jobs = await jobsOf(booking.booking.code);
    expect(jobs.map((j) => [j.status, j.last_error])).toEqual([
      ['cancelled', 'rescheduled'],
      ['pending', null],
    ]);
    expect(jobs[1]!.run_at.getTime()).toBe(target!.ts.getTime() - 24 * 3600 * 1000);
    await dispatch();
    expect(hits(endpoint)).toHaveLength(0);
  });

  it('a cancelled booking never gets a reminder', async () => {
    // 20 h ahead: still within the 24 h reminder window, but before the 12 h online-cancel deadline.
    const [later] = await su<{ ts: Date }>(pool, `select date_trunc('hour', now()) + interval '20 hours' as ts`);
    const booking = await newBooking(0, slug, serviceId, later!.ts.toISOString());
    const { endpoint } = await subscribe(booking, 'ok');
    const cancelled = await call<Record<string, unknown>>(pool, anon(), 'select public.cancel_booking($1, $2, $3)', [slug, booking.access_token, null]);
    expect(cancelled).toMatchObject({ ok: true });
    expect((await jobsOf(booking.booking.code)).map((j) => j.status)).toEqual(['cancelled']);
    await dispatch();
    expect(hits(endpoint)).toHaveLength(0);
  });
});

describe('push service answers', () => {
  it('410 Gone revokes the subscription and closes the job', async () => {
    const booking = await newBooking(5);
    const { endpoint } = await subscribe(booking, 'gone');
    await dispatch();
    expect(hits(endpoint)).toHaveLength(1);
    const [sub] = await su<{ revoked_at: Date | null; last_error: string | null }>(
      pool,
      'select revoked_at, last_error from public.push_subscriptions where endpoint = $1',
      [endpoint],
    );
    expect(sub!.revoked_at).not.toBeNull();
    expect((await jobsOf(booking.booking.code)).map((j) => [j.status, j.last_error])).toEqual([['skipped', 'no_subscribers']]);
  });

  it('503 puts the job back with backoff instead of losing it', async () => {
    const booking = await newBooking(5);
    await subscribe(booking, 'busy');
    await dispatch();
    const [job] = await jobsOf(booking.booking.code);
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job!.last_error).toMatch(/HTTP 503|push_service/);
    expect(job!.run_at.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('preview, configuration and access', () => {
  it('preview studios record the subscription but never send', async () => {
    const [demo] = await su<{ id: string }>(pool, `select s.id from public.services s join public.tenants t on t.id = s.tenant_id
      where t.slug = 'graphite' and s.is_active order by s.sort limit 1`);
    const [from] = await su<{ d: string }>(pool, `select ((now() at time zone 'Europe/Moscow')::date + 2)::text as d`);
    const slots = await call<{ days: { slots: { starts_at: string; available: boolean }[] }[] }>(
      pool,
      anon(),
      'select public.get_available_slots($1, $2, $3::date, $4)',
      ['graphite', demo!.id, from!.d, 10],
    );
    const free = slots.days.flatMap((d) => d.slots).find((x) => x.available)!;
    const booking = await newBooking(0, 'graphite', demo!.id, free.starts_at);
    const { endpoint, result } = await subscribe(booking, 'ok', 'graphite');
    expect(result).toMatchObject({ ok: true, state: 'preview' });
    await su(pool, `update public.notification_jobs j set run_at = now() from public.bookings b where b.id = j.booking_id and b.code = $1`, [
      booking.booking.code,
    ]);
    await dispatch();
    expect(hits(endpoint)).toHaveLength(0);
    expect((await jobsOf(booking.booking.code)).map((j) => [j.status, j.last_error])).toEqual([['skipped', 'preview_tenant']]);
  });

  it('refuses callers without the cron secret and does nothing without VAPID keys', async () => {
    expect((await dispatch('wrong')).status).toBe(403);
    const booking = await newBooking(5);
    const { endpoint } = await subscribe(booking, 'ok');
    expect((await dispatch(SECRET, null)).status).toBe(503);
    expect(hits(endpoint)).toHaveLength(0);
    expect((await jobsOf(booking.booking.code)).map((j) => j.status)).toEqual(['pending']);
  });

  it('accepts only browser push services as endpoints (no SSRF through the dispatcher)', async () => {
    const booking = await newBooking(5);
    for (const endpoint of ['http://evil.example/collect', 'https://10.0.0.5/x', 'file:///etc/passwd']) {
      const r = await call<Record<string, unknown>>(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [
        slug,
        booking.access_token,
        JSON.stringify({ endpoint, keys: { p256dh: b64urlEncode(createECDH('prime256v1').generateKeys()), auth: b64urlEncode(randomBytes(16)) } }),
      ]);
      expect(r).toMatchObject({ ok: false, error: 'invalid_subscription' });
    }
  });
});
