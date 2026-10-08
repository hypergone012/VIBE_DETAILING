import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { demoOwnerPassword } from '../../scripts/tenant/seed.ts';
import { anonClient, ownerClient, serviceClient } from './env.ts';

/**
 * HTTP-level checks of what the deployed API actually exposes (Kong → PostgREST,
 * GoTrue, Storage), using the demo studios from supabase/seed.sql.
 */
describe('public API surface (publishable key)', () => {
  it('serves the studio page data and nothing personal', async () => {
    const { data, error } = await anonClient().rpc('get_public_tenant', { p_slug: 'graphite' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, tenant: { slug: 'graphite', status: 'preview' } });
    expect(JSON.stringify(data)).not.toMatch(/\+7900000110/);
  });

  it('denies direct table reads to anon for every table', async () => {
    const client = anonClient();
    for (const table of ['bookings', 'payments', 'booking_access_tokens', 'tenants', 'resource_occupancies', 'push_subscriptions']) {
      const { data, error } = await client.from(table).select('*').limit(1);
      expect(error, table).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it('does not expose admin, worker or assistant-budget RPCs to anon', async () => {
    const client = anonClient();
    const calls = [
      client.rpc('admin_publish_tenant', { p_config: {}, p_options: {} }),
      client.rpc('claim_notification_jobs', { p_worker: 'x', p_limit: 1, p_lease_seconds: 10 }),
      client.rpc('assistant_begin', { p_slug: 'graphite', p_scope: 'client', p_client_ip: '1.1.1.1', p_reserve_tokens: 1 }),
    ];
    for (const res of await Promise.all(calls)) expect(res.error).not.toBeNull();
  });

  it('public sign-up is disabled', async () => {
    const { error } = await anonClient().auth.signUp({ email: `x-${randomUUID()}@example.com`, password: 'some-password-123' });
    expect(error?.message ?? '').toMatch(/not allowed|disabled/i);
  });
});

describe('owner auth and tenant membership (real GoTrue JWT)', () => {
  it('the owner of one studio reads only that studio', async () => {
    const owner = await ownerClient('owner@graphite.example', demoOwnerPassword('graphite'));
    const session = await owner.rpc('owner_session', { p_slug: 'graphite' });
    expect(session.error).toBeNull();
    expect(session.data).toMatchObject({ slug: 'graphite', role: 'owner' });

    const foreign = await owner.rpc('owner_schedule', { p_slug: 'severny-boks', p_period: 'today' });
    expect(foreign.error?.message).toBe('forbidden');

    const rows = await owner.from('bookings').select('tenant_id, service_name');
    expect(rows.error).toBeNull();
    const tenantIds = new Set((rows.data ?? []).map((r) => r.tenant_id));
    expect(tenantIds.size).toBe(1);
    await owner.auth.signOut();
  });

  it('storage: owners upload only into their own studio folder', async () => {
    const owner = await ownerClient('owner@graphite.example', demoOwnerPassword('graphite'));
    const session = await owner.rpc('owner_session', { p_slug: 'graphite' });
    const otherInfo = await serviceClient().rpc('admin_tenant_info', { p_slug: 'severny-boks' });
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const own = await owner.storage
      .from('tenant-media')
      .upload(`${(session.data as { tenant_id: string }).tenant_id}/owner/${randomUUID()}.png`, png, { contentType: 'image/png' });
    expect(own.error).toBeNull();
    const foreign = await owner.storage
      .from('tenant-media')
      .upload(`${(otherInfo.data as { tenant_id: string }).tenant_id}/owner/${randomUUID()}.png`, png, { contentType: 'image/png' });
    expect(foreign.error).not.toBeNull();
    const config = await owner.storage
      .from('tenant-media')
      .upload(`${(session.data as { tenant_id: string }).tenant_id}/config/${randomUUID()}.png`, png, { contentType: 'image/png' });
    expect(config.error).not.toBeNull();
    await owner.auth.signOut();
  });
});
