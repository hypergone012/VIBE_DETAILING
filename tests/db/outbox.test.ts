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
  makeTenantLive,
  newPool,
  owner,
  resetRateLimits,
  service,
  su,
  uniqueSlug,
  type Envelope,
} from './helpers';

let pool: pg.Pool;

const subscription = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}-${n}`,
  keys: {
    p256dh: 'BOr4V8nD6Qw0hY0Hk8yq7bQb0w0p3p0t2y8m6nE0q0c7cPZ8gq3s2yK1i7g1Gm5X8i6m3T4c9a0bQ1w2e3r4t5y',
    auth: 'k8JQ2a1b3c4d5e6f7g8h9i',
  },
});

beforeAll(async () => {
  pool = newPool();
});
beforeEach(async () => {
  await resetRateLimits(pool);
});
afterAll(async () => {
  await pool.end();
});

async function liveStudioWithBooking(daysAhead = 3, time = '10:00') {
  const slug = uniqueSlug('push');
  const t = await createTenant(pool, slug);
  await makeTenantLive(pool, slug);
  const ownerId = await createOwner(pool, slug);
  const res = await createBooking(pool, slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', daysAhead, time));
  if (!res.ok) throw new Error('booking failed');
  const [{ id }] = await su<{ id: string }>(pool, 'select id from public.bookings where tenant_id = $1 and code = $2', [
    t.tenantId,
    res.booking.code,
  ]);
  return { t, ownerId, token: res.access_token, bookingId: id, startsAt: res.booking.starts_at };
}

const jobs = (bookingId: string) =>
  su<{ status: string; dedupe_key: string; run_at: Date; last_error: string | null }>(
    pool,
    'select status, dedupe_key, run_at, last_error from public.notification_jobs where booking_id = $1 order by created_at',
    [bookingId],
  );

describe('reminder outbox', () => {
  it('opting in schedules one reminder 24h before the visit; repeating it does not duplicate', async () => {
    const s = await liveStudioWithBooking();
    const sub = subscription();
    const r1 = await call<Envelope<{ state: string; reminder_at: string }>>(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [
      s.t.slug,
      s.token,
      JSON.stringify(sub),
    ]);
    expect(r1).toMatchObject({ ok: true, state: 'scheduled' });
    if (!r1.ok) return;
    expect(new Date(r1.reminder_at).getTime()).toBe(new Date(s.startsAt).getTime() - 24 * 3600_000);
    await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [s.t.slug, s.token, JSON.stringify(sub)]);
    expect(await jobs(s.bookingId)).toHaveLength(1);
  });

  it('rejects endpoints that are not browser push services (no SSRF through the dispatcher)', async () => {
    const s = await liveStudioWithBooking();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://evil.example.com/push']) {
      const res = await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [
        s.t.slug,
        s.token,
        JSON.stringify({ ...subscription(), endpoint }),
      ]);
      expect(res, endpoint).toMatchObject({ ok: false, error: 'invalid_subscription' });
    }
  });

  it('reschedule cancels the old job and creates one for the new time; cancel cancels it', async () => {
    const s = await liveStudioWithBooking();
    await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [s.t.slug, s.token, JSON.stringify(subscription())]);
    const newStart = await localStart(pool, 'Europe/Moscow', 5, '15:00');
    await call(pool, owner(s.ownerId), 'select public.owner_reschedule_booking($1, $2, $3)', [s.t.slug, s.bookingId, newStart]);
    let list = await jobs(s.bookingId);
    expect(list.map((j) => j.status)).toEqual(['cancelled', 'pending']);
    expect(list[1]!.run_at.getTime()).toBe(new Date(newStart).getTime() - 24 * 3600_000);

    await call(pool, owner(s.ownerId), 'select public.owner_cancel_booking($1, $2, null)', [s.t.slug, s.bookingId]);
    list = await jobs(s.bookingId);
    expect(list.map((j) => j.status)).toEqual(['cancelled', 'cancelled']);
    expect(list[1]!.last_error).toBe('booking_cancelled');
  });

  it('claims with a lease: two workers never get the same job; only the holder completes it', async () => {
    const s = await liveStudioWithBooking();
    await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [s.t.slug, s.token, JSON.stringify(subscription())]);
    await su(pool, `update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [s.bookingId]);

    const [w1, w2] = await Promise.all(
      ['worker-1', 'worker-2'].map((w) =>
        call<{ jobs: Array<{ job_id: string; booking: { id: string }; subscriptions: unknown[] }> }>(
          pool,
          service,
          'select public.claim_notification_jobs($1, 50, 60)',
          [w],
        ),
      ),
    );
    const mine = (r: typeof w1) => r.jobs.filter((j) => j.booking.id === s.bookingId);
    expect(mine(w1).length + mine(w2).length).toBe(1);
    const holder = mine(w1).length ? 'worker-1' : 'worker-2';
    const other = holder === 'worker-1' ? 'worker-2' : 'worker-1';
    const job = (mine(w1)[0] ?? mine(w2)[0])!;
    expect(job.subscriptions).toHaveLength(1);

    const stolen = await call<{ applied: boolean }>(pool, service, 'select public.complete_notification_job($1, $2, $3)', [
      job.job_id,
      other,
      'sent',
    ]);
    expect(stolen.applied).toBe(false);
    const done = await call<{ applied: boolean; status: string }>(pool, service, 'select public.complete_notification_job($1, $2, $3)', [
      job.job_id,
      holder,
      'sent',
    ]);
    expect(done).toMatchObject({ applied: true, status: 'sent' });
    const again = await call<{ jobs: Array<{ booking: { id: string } }> }>(pool, service, 'select public.claim_notification_jobs($1, 50, 60)', [
      'worker-3',
    ]);
    expect(again.jobs.filter((j) => j.booking.id === s.bookingId)).toHaveLength(0);
  });

  it('an expired lease is reclaimed; retry backs off; gone endpoints are revoked', async () => {
    const s = await liveStudioWithBooking();
    const sub = subscription();
    await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [s.t.slug, s.token, JSON.stringify(sub)]);
    await su(pool, `update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [s.bookingId]);
    const first = await call<{ jobs: Array<{ job_id: string; booking: { id: string } }> }>(pool, service, 'select public.claim_notification_jobs($1, 50, 10)', ['crashy']);
    const job = first.jobs.find((j) => j.booking.id === s.bookingId)!;
    // Simulate a crashed worker: lease runs out.
    await su(pool, `update public.notification_jobs set lease_until = now() - interval '1 second' where id = $1`, [job.job_id]);
    const second = await call<{ jobs: Array<{ job_id: string; attempts: number }> }>(pool, service, 'select public.claim_notification_jobs($1, 50, 60)', ['healthy']);
    const reclaimed = second.jobs.find((j) => j.job_id === job.job_id)!;
    expect(reclaimed.attempts).toBe(2);
    expect((await call<{ applied: boolean }>(pool, service, 'select public.complete_notification_job($1, $2, $3)', [job.job_id, 'crashy', 'sent'])).applied).toBe(false);

    await call(pool, service, 'select public.complete_notification_job($1, $2, $3, $4, $5::text[])', [
      job.job_id,
      'healthy',
      'retry',
      'push service 503',
      [sub.endpoint],
    ]);
    const [row] = await su<{ status: string; run_at: Date }>(pool, 'select status, run_at from public.notification_jobs where id = $1', [job.job_id]);
    expect(row!.status).toBe('pending');
    expect(row!.run_at.getTime()).toBeGreaterThan(Date.now() + 60_000);
    const [subRow] = await su<{ revoked_at: Date | null }>(pool, 'select revoked_at from public.push_subscriptions where endpoint = $1', [
      sub.endpoint,
    ]);
    expect(subRow!.revoked_at).not.toBeNull();
  });

  it('preview studios and demo bookings are skipped, never sent', async () => {
    const slug = uniqueSlug('preview');
    const t = await createTenant(pool, slug);
    const res = await createBooking(pool, slug, t.services.wash!, await localStart(pool, 'Europe/Moscow', 3, '10:00'));
    if (!res.ok) throw new Error('booking failed');
    const reg = await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [slug, res.access_token, JSON.stringify(subscription())]);
    expect(reg).toMatchObject({ ok: true, state: 'preview' });
    const [{ id }] = await su<{ id: string }>(pool, 'select id from public.bookings where tenant_id = $1', [t.tenantId]);
    await su(pool, `update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [id]);
    const claimed = await call<{ jobs: Array<{ booking: { id: string } }> }>(pool, service, 'select public.claim_notification_jobs($1, 50, 60)', ['w']);
    expect(claimed.jobs.filter((j) => j.booking.id === id)).toHaveLength(0);
    const [job] = await jobs(id);
    expect(job).toMatchObject({ status: 'skipped', last_error: 'preview_tenant' });
  });

  it('a booking made less than a day ahead gets an immediate reminder; within 2 hours none', async () => {
    const slug = uniqueSlug('soon');
    const t = await createTenant(pool, slug);
    await makeTenantLive(pool, slug);
    const at = async (hours: number) => {
      const [{ ts }] = await su<{ ts: Date }>(
        pool,
        `select date_bin('30 minutes', now() + make_interval(hours => $1), timestamptz '2000-01-01') + interval '30 minutes' as ts`,
        [hours],
      );
      return ts.toISOString();
    };
    const in5h = await createBooking(pool, slug, t.services.wash!, await at(5));
    const in1h = await createBooking(pool, slug, t.services.wash!, await at(0));
    if (!in5h.ok || !in1h.ok) throw new Error('booking failed');
    const r5 = await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [slug, in5h.access_token, JSON.stringify(subscription())]);
    const r1 = await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [slug, in1h.access_token, JSON.stringify(subscription())]);
    expect(r5).toMatchObject({ ok: true, state: 'scheduled' });
    expect(r1).toMatchObject({ ok: true, state: 'too_late' });
    const [job] = await su<{ run_at: Date }>(
      pool,
      `select j.run_at from public.notification_jobs j join public.bookings b on b.id = j.booking_id where b.code = $1 and b.tenant_id = $2`,
      [in5h.booking.code, t.tenantId],
    );
    expect(Math.abs(job!.run_at.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe('cron wiring', () => {
  it('schedules the dispatcher and the counter cleanup in pg_cron', async () => {
    const cronJobs = await su<{ jobname: string; schedule: string }>(
      pool,
      `select jobname, schedule from cron.job where jobname in ('notifications-dispatch', 'rate-counters-cleanup') order by jobname`,
    );
    expect(cronJobs).toEqual([
      { jobname: 'notifications-dispatch', schedule: '* * * * *' },
      { jobname: 'rate-counters-cleanup', schedule: '17 * * * *' },
    ]);
    // Without Vault secrets the invoker is a no-op instead of failing.
    await su(pool, 'select private.invoke_dispatch()');
  });
});

describe('payload privacy', () => {
  it('claimed job payload carries no phone or customer name', async () => {
    const s = await liveStudioWithBooking();
    await call(pool, anon(), 'select public.register_push($1, $2, $3::jsonb)', [s.t.slug, s.token, JSON.stringify(subscription())]);
    await su(pool, `update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [s.bookingId]);
    const claimed = await call(pool, service, 'select public.claim_notification_jobs($1, 50, 60)', [randomUUID()]);
    const text = JSON.stringify(claimed);
    expect(text).not.toContain('+7900');
    expect(text).not.toContain('Иван');
  });
});
