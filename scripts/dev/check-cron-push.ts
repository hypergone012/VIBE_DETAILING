/**
 * Local end-to-end check of reminders: Supabase Cron → pg_net → Edge Function
 * `notifications-dispatch` (Deno) → push service. The push service is FAKE (a
 * local HTTP server standing in for FCM/Mozilla/Apple), so this proves the chain
 * and the encryption, not delivery to a real phone.
 *
 *   1. pnpm push:vapid → export DISPATCH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *   2. pnpm functions:serve   (same shell / same variables)
 *   3. DISPATCH_SECRET=… tsx scripts/dev/check-cron-push.ts
 */
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import ece from 'http_ece';
import pg from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SECRET = process.env.DISPATCH_SECRET;
const PORT = Number(process.env.FAKE_PUSH_PORT ?? 54398);
// The database and the Edge Runtime run in Docker: they reach the host and Kong by these names.
const PROJECT_URL_FOR_DB = process.env.PROJECT_URL_FOR_DB ?? 'http://kong:8000';
const PUSH_HOST_FOR_RUNTIME = process.env.PUSH_HOST_FOR_RUNTIME ?? 'host.docker.internal';

if (!SECRET) {
  console.error('Set DISPATCH_SECRET (the same value the functions are served with).');
  process.exit(1);
}

const b64url = (b: Buffer) => b.toString('base64url');
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

async function upsertSecret(name: string, value: string) {
  const { rows } = await db.query('select id from vault.secrets where name = $1', [name]);
  if (rows[0]) await db.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await db.query('select vault.create_secret($1, $2)', [value, name]);
}

let resolveHit: (v: { headers: Record<string, unknown>; body: Buffer }) => void;
const hit = new Promise<{ headers: Record<string, unknown>; body: Buffer }>((r) => (resolveHit = r));
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  res.writeHead(201).end();
  resolveHit({ headers: req.headers, body: Buffer.concat(chunks) });
});
await new Promise<void>((r) => server.listen(PORT, '0.0.0.0', r));

try {
  await upsertSecret('project_url', PROJECT_URL_FOR_DB);
  await upsertSecret('dispatch_secret', SECRET);
  await db.query(`update private.app_config set value = 'true' where key = 'push.allow_insecure_test_endpoints'`);

  const slug = `cron-check-${randomUUID().slice(0, 6)}`;
  const config = {
    slug,
    name: 'Проверка напоминаний',
    short_name: 'Проверка',
    timezone: 'Europe/Moscow',
    accent_color: '#4690FF',
    contacts: { phone: '+7 900 000-00-00', address: 'Тестовый адрес' },
    booking: { slot_step_minutes: 30, min_lead_minutes: 0, horizon_days: 7, cancel_until_hours: 0 },
    resources: [{ key: 'box-1', name: 'Бокс 1' }],
    services: [{ key: 'wash', name: 'Мойка', price_minor: 100000, duration_minutes: 60, resources: ['box-1'] }],
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '23:59' })),
    info_cards: [
      { title: 'Проверка', text: 'Карточка для проверки напоминаний.', icon: 'clock' },
      { title: 'Проверка', text: 'Карточка для проверки напоминаний.', icon: 'clock' },
      { title: 'Проверка', text: 'Карточка для проверки напоминаний.', icon: 'clock' },
    ],
  };
  await db.query('select public.admin_publish_tenant($1::jsonb, $2::jsonb)', [JSON.stringify(config), JSON.stringify({ activate: true })]);
  const { rows: svc } = await db.query(`select s.id from public.services s join public.tenants t on t.id = s.tenant_id where t.slug = $1`, [slug]);
  const { rows: start } = await db.query(`select date_trunc('hour', now()) + interval '6 hours' as ts`);
  const { rows: created } = await db.query('select public.create_booking($1, $2, $3, $4::jsonb, $5) as r', [
    slug,
    svc[0].id,
    start[0].ts,
    JSON.stringify({ name: 'Проверка Крона', phone: '+7 900 111-22-33', car: 'Lada Vesta', consent: true }),
    randomUUID(),
  ]);
  const booking = created[0].r as { ok: boolean; access_token: string; booking: { code: string } };
  if (!booking.ok) throw new Error(`booking failed: ${JSON.stringify(booking)}`);

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `http://${PUSH_HOST_FOR_RUNTIME}:${PORT}/ok/${randomUUID()}`;
  const { rows: reg } = await db.query('select public.register_push($1, $2, $3::jsonb) as r', [
    slug,
    booking.access_token,
    JSON.stringify({ endpoint, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } }),
  ]);
  console.log('subscription:', reg[0].r);
  console.log(`booking ${booking.booking.code}: waiting for Supabase Cron (fires every minute)…`);

  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no push within 150 s')), 150_000));
  const msg = await Promise.race([hit, timeout]);
  const payload = JSON.parse(ece.decrypt(msg.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString());
  const { rows: job } = await db.query(
    `select j.status, j.attempts, j.sent_at from public.notification_jobs j join public.bookings b on b.id = j.booking_id where b.code = $1`,
    [booking.booking.code],
  );
  await new Promise((r) => setTimeout(r, 1500));
  const { rows: jobAfter } = await db.query(
    `select j.status, j.attempts, j.sent_at, j.locked_by from public.notification_jobs j join public.bookings b on b.id = j.booking_id where b.code = $1`,
    [booking.booking.code],
  );
  console.log('push received:', { encoding: msg.headers['content-encoding'], ttl: msg.headers.ttl, vapid: String(msg.headers.authorization).slice(0, 18) + '…' });
  console.log('decrypted payload:', payload);
  console.log('job:', jobAfter[0] ?? job[0]);
  const { rows: runs } = await db.query(
    `select status, return_message, start_time from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname = 'notifications-dispatch' order by start_time desc limit 1`,
  );
  console.log('last cron run:', runs[0]);
} finally {
  await db.query(`update private.app_config set value = 'false' where key = 'push.allow_insecure_test_endpoints'`);
  server.close();
  await db.end();
}
