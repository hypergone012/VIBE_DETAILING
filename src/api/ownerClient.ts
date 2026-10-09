import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

const clients = new Map<string, SupabaseClient>();

/** Storage key of the owner session for one studio (separate per slug, never shared). */
export const ownerAuthKey = (slug: string) => `owner-auth:${slug}`;

/**
 * Full Supabase client for the owner cabinet of one studio: Auth (e-mail +
 * password, no sign-up from the app), RPC as `authenticated` and Storage
 * uploads. Loaded only by the cabinet chunk; the public client never ships Auth.
 */
export function getOwnerClient(slug: string): SupabaseClient {
  let client = clients.get(slug);
  if (!client) {
    client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: ownerAuthKey(slug),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    clients.set(slug, client);
  }
  return client;
}
