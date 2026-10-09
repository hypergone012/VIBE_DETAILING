/**
 * `notifications-dispatch` handler (Fetch API only). Invoked every minute by
 * Supabase Cron through pg_net with a shared secret. Claims due jobs from the
 * outbox with a lease, sends the encrypted reminder to every live subscription
 * and completes each job (only the lease holder can complete it).
 */
import { postgrestRpc } from '../assistant/backend.ts';
import { formatTime, localDate, relativeDay } from '../assistant/text.ts';
import { sendWebPush, type DeliveryResult, type VapidKeys } from './webpush.ts';

export interface DispatchEnv {
  supabaseUrl: string;
  serviceKey: string;
  dispatchSecret: string;
  vapid: VapidKeys | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Wall-clock budget per invocation (cron fires every minute). */
  budgetMs?: number;
}

interface Job {
  job_id: string;
  kind: 'reminder_24h';
  attempts: number;
  dedupe_key: string;
  booking: { id: string; code: string; service_name: string; starts_at: string; status: string };
  tenant: { slug: string; name: string; short_name: string; timezone: string; address: string | null };
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
}

export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Text of the reminder in the studio timezone («Завтра в 10:00 — …»). */
export function reminderPayload(job: Job, now: Date): ReminderPayload {
  const tz = job.tenant.timezone;
  const day = relativeDay(localDate(new Date(job.booking.starts_at), tz), localDate(now, tz));
  const when = `${day.charAt(0).toUpperCase()}${day.slice(1)} в ${formatTime(job.booking.starts_at, tz)}`;
  return {
    title: `Напоминание: ${job.tenant.short_name}`,
    body: `${when} — ${job.booking.service_name}.${job.tenant.address ? ` ${job.tenant.address}.` : ''} Код записи ${job.booking.code}.`,
    url: `/s/${job.tenant.slug}/my/${job.booking.code}`,
    tag: `reminder-${job.booking.code}`,
  };
}

/** Constant-time comparison of the cron secret. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function jobOutcome(results: DeliveryResult[]): { outcome: 'sent' | 'retry' | 'no_subscribers' | 'failed'; error: string | null } {
  if (results.some((r) => r.outcome === 'sent')) return { outcome: 'sent', error: null };
  if (results.some((r) => r.outcome === 'retry')) return { outcome: 'retry', error: results.find((r) => r.outcome === 'retry')?.error ?? 'push_service_unavailable' };
  if (results.length === 0 || results.every((r) => r.outcome === 'gone')) return { outcome: 'no_subscribers', error: null };
  return { outcome: 'failed', error: results.map((r) => r.error ?? r.outcome).join('; ').slice(0, 300) };
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleDispatch(req: Request, env: DispatchEnv): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env.dispatchSecret) return json({ error: 'not_configured', message: 'DISPATCH_SECRET is not set' }, 503);
  if (!safeEqual(req.headers.get('x-dispatch-secret') ?? '', env.dispatchSecret)) return json({ error: 'forbidden' }, 403);
  if (!env.vapid) return json({ error: 'push_not_configured', message: 'VAPID keys are not set; jobs stay queued' }, 503);

  const rpc = postgrestRpc({ url: env.supabaseUrl, apikey: env.serviceKey });
  const worker = `dispatch-${crypto.randomUUID()}`;
  const started = Date.now();
  const budget = env.budgetMs ?? 25_000;
  const now = env.now ?? (() => new Date());
  const summary = { claimed: 0, sent: 0, retry: 0, failed: 0, no_subscribers: 0, gone_endpoints: 0 };

  for (let batch = 0; batch < 5 && Date.now() - started < budget; batch++) {
    const { jobs } = (await rpc('claim_notification_jobs', { p_worker: worker, p_limit: 20, p_lease_seconds: 120 })) as { jobs: Job[] };
    if (!jobs.length) break;
    summary.claimed += jobs.length;

    for (const job of jobs) {
      const payload = reminderPayload(job, now());
      const ttl = Math.min(24 * 3600, Math.max(60, (new Date(job.booking.starts_at).getTime() - now().getTime()) / 1000));
      const results = await Promise.all(
        job.subscriptions.map((s) => sendWebPush(s, payload, { vapid: env.vapid!, ttlSeconds: ttl, urgency: 'normal', fetchImpl: env.fetchImpl })),
      );
      const { outcome, error } = jobOutcome(results);
      const gone = results.filter((r) => r.outcome === 'gone').map((r) => r.endpoint);
      summary[outcome] += 1;
      summary.gone_endpoints += gone.length;
      await rpc('complete_notification_job', {
        p_job_id: job.job_id,
        p_worker: worker,
        p_outcome: outcome,
        p_error: error,
        p_gone_endpoints: gone,
        p_result: { deliveries: results.map((r) => ({ outcome: r.outcome, status: r.status, host: new URL(r.endpoint).host })) },
      });
    }
  }
  return json({ ok: true, worker, ...summary }, 200);
}
