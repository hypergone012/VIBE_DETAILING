// Supabase Edge Function `notifications-dispatch` (Deno). Called by Supabase Cron
// (pg_net, see migration *_notifications.sql) with the x-dispatch-secret header.
// Logic: ../_shared/push (WebCrypto Web Push, unit/integration-tested in Node).
import { handleDispatch } from '../_shared/push/dispatch.ts';

const env = (key: string) => Deno.env.get(key) ?? '';

function serviceKey(): string {
  const raw = env('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const value = keys.default ?? Object.values(keys)[0];
      if (value) return value;
    } catch {
      // not JSON
    }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

const vapid =
  env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY') && env('VAPID_SUBJECT')
    ? { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') }
    : null;

Deno.serve((req) =>
  handleDispatch(req, {
    supabaseUrl: env('SUPABASE_URL'),
    serviceKey: serviceKey(),
    dispatchSecret: env('DISPATCH_SECRET'),
    vapid,
  }),
);
