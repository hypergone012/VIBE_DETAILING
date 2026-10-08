import { PostgrestClient } from '@supabase/postgrest-js';
import { env } from '@/lib/env';

let publicClient: PostgrestClient | null = null;

/**
 * Anonymous PostgREST client for public studio data and client bookings. A client
 * never signs in (access to a booking is its token), so the public bundle ships
 * only the PostgREST client — no auth, storage or realtime code.
 */
export function getPublicClient(): PostgrestClient {
  publicClient ??= new PostgrestClient(`${env.VITE_SUPABASE_URL}/rest/v1`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
  });
  return publicClient;
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${env.VITE_SUPABASE_URL}/storage/v1/object/public/tenant-media/${path}`;
}
