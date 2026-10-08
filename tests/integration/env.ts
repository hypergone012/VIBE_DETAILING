import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pipelineEnv } from '../../scripts/tenant/env.ts';

/** Clients against the running local Supabase stack (real Kong → PostgREST/GoTrue/Storage). */
export function apiEnv() {
  return pipelineEnv();
}

export function anonClient(): SupabaseClient {
  const env = pipelineEnv();
  return createClient(env.supabaseUrl, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function serviceClient(): SupabaseClient {
  const env = pipelineEnv();
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ownerClient(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}
