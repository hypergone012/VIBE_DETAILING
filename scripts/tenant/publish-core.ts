import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareMedia } from './images.ts';
import { tenantDir } from './load.ts';
import { normalizeBusiness, type Business, type MediaPaths } from './schema.ts';

export interface PublishResult {
  tenant_id: string;
  slug: string;
  status: string;
  created: boolean;
  config_version: number;
  purged_demo_bookings: number;
  owner_overrides: string[];
  skipped: unknown[];
  uploaded: number;
}

export async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}${error.hint && error.hint !== error.message ? ` — ${error.hint}` : ''}`);
  return data as T;
}

/**
 * business.json + images → Storage + database.
 * Images are content-addressed (<tenant_id>/config/<name>-<sha>.webp), so a republish
 * uploads only what changed and never touches owner uploads (<tenant_id>/owner/...).
 */
export async function publishTenant(
  client: SupabaseClient,
  b: Business,
  options: { activate?: boolean } = {},
): Promise<PublishResult> {
  const empty: MediaPaths = { logo_path: null, hero_path: null, works: {} };
  let info = await rpc<{ tenant_id: string } | null>(client, 'admin_tenant_info', { p_slug: b.slug });
  const created = !info;
  if (!info) {
    await rpc(client, 'admin_publish_tenant', { p_config: normalizeBusiness(b, empty), p_options: {} });
    info = await rpc<{ tenant_id: string }>(client, 'admin_tenant_info', { p_slug: b.slug });
  }
  const tenantId = info!.tenant_id;

  const media = await prepareMedia(tenantDir(b.slug), b);
  const paths: MediaPaths = { logo_path: null, hero_path: null, works: {} };
  let uploaded = 0;
  for (const m of media) {
    const path = `${tenantId}/config/${m.name}`;
    const { error } = await client.storage.from('tenant-media').upload(path, m.buffer, {
      contentType: m.contentType,
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
    uploaded += 1;
    if (m.role === 'logo') paths.logo_path = path;
    else if (m.role === 'hero') paths.hero_path = path;
    else paths.works[m.role.slice('work:'.length)] = path;
  }

  const result = await rpc<Omit<PublishResult, 'uploaded'>>(client, 'admin_publish_tenant', {
    p_config: normalizeBusiness(b, paths),
    p_options: { activate: Boolean(options.activate) },
  });
  return { ...result, created, uploaded };
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(18), (x) => alphabet[x % alphabet.length]).join('');
}

export interface OwnerResult {
  userId: string;
  email: string;
  created: boolean;
  /** Present only when a password was set in this run (shown once, never stored). */
  password?: string;
}

/** Ensures a Supabase Auth user for the owner and their membership in the studio. */
export async function ensureOwner(
  client: SupabaseClient,
  slug: string,
  email: string,
  opts: { resetPassword?: boolean; password?: string } = {},
): Promise<OwnerResult> {
  const normalized = email.trim().toLowerCase();
  let existing: { id: string } | undefined;
  for (let page = 1; page < 50 && !existing; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth.listUsers: ${error.message}`);
    existing = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (data.users.length < 200) break;
  }

  let result: OwnerResult;
  if (!existing) {
    const password = opts.password ?? generatePassword();
    const { data, error } = await client.auth.admin.createUser({ email: normalized, password, email_confirm: true });
    if (error || !data.user) throw new Error(`auth.createUser: ${error?.message ?? 'no user'}`);
    result = { userId: data.user.id, email: normalized, created: true, password };
  } else if (opts.resetPassword || opts.password) {
    const password = opts.password ?? generatePassword();
    const { error } = await client.auth.admin.updateUserById(existing.id, { password });
    if (error) throw new Error(`auth.updateUser: ${error.message}`);
    result = { userId: existing.id, email: normalized, created: false, password };
  } else {
    result = { userId: existing.id, email: normalized, created: false };
  }
  await rpc(client, 'admin_add_member', { p_slug: slug, p_user_id: result.userId, p_role: 'owner' });
  return result;
}

export function writePublishRecord(slug: string, host: string, record: unknown): string {
  const dir = join(tenantDir(slug), '.publish');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${host.replace(/[^a-z0-9.-]/gi, '_')}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
