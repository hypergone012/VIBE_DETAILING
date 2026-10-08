/**
 * Server-side configuration for pipeline scripts.
 *
 * Production: SUPABASE_URL + SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)
 * and PUBLIC_SITE_URL come from the operator's shell / CI secrets — never from the repo.
 * Local: when they are absent, the values of the running `supabase start` stack are used.
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PipelineEnv {
  supabaseUrl: string;
  serviceKey: string;
  publishableKey: string;
  siteUrl: string;
  isLocal: boolean;
}

let cached: PipelineEnv | null = null;

function localStatus(): Record<string, string> | null {
  try {
    const out = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  } catch {
    return null;
  }
}

export function pipelineEnv(): PipelineEnv {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    cached = {
      supabaseUrl: url.replace(/\/$/, ''),
      serviceKey: key,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
      siteUrl: (process.env.PUBLIC_SITE_URL ?? '').replace(/\/$/, ''),
      isLocal: /127\.0\.0\.1|localhost/.test(url),
    };
    return cached;
  }
  const local = localStatus();
  if (!local?.API_URL) {
    throw new Error(
      'Нет доступа к Supabase: задайте SUPABASE_URL и SUPABASE_SECRET_KEY (см. SETUP.md) или запустите локальный стек `pnpm db:start`.',
    );
  }
  cached = {
    supabaseUrl: local.API_URL,
    serviceKey: local.SECRET_KEY ?? local.SERVICE_ROLE_KEY ?? '',
    publishableKey: local.PUBLISHABLE_KEY ?? local.ANON_KEY ?? '',
    siteUrl: (process.env.PUBLIC_SITE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, ''),
    isLocal: true,
  };
  return cached;
}

export function adminClient(): SupabaseClient {
  const env = pipelineEnv();
  return createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicClient(): SupabaseClient {
  const env = pipelineEnv();
  return createClient(env.supabaseUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function storagePublicUrl(path: string): string {
  return `${pipelineEnv().supabaseUrl}/storage/v1/object/public/tenant-media/${path}`;
}
