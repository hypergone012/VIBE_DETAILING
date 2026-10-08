import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadBusiness, ROOT } from '../../scripts/tenant/load.ts';
import { ensureOwner, publishTenant } from '../../scripts/tenant/publish-core.ts';
import { anonClient, ownerClient, serviceClient } from './env.ts';

/**
 * The studio pipeline as an operator runs it: tenant:new → tenant:validate →
 * tenant:publish, then an owner edit and a republish that must keep it.
 */
const slug = `it-${Date.now().toString(36)}`;
const dir = join(ROOT, 'tenants', slug);
const run = (script: string, ...args: string[]) =>
  execFileSync('pnpm', ['-s', 'tsx', `scripts/tenant/${script}.ts`, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('studio pipeline', () => {
  it('creates a new studio folder that validates as a preview but not as live', () => {
    const out = run('new', slug, '--name', 'Тест Студия Интеграция', '--accent', '#22C55E', '--timezone', 'Europe/Samara');
    expect(out).toContain(`tenants/${slug}/`);
    expect(existsSync(join(dir, 'images', 'logo.png'))).toBe(true);
    expect(run('validate', slug)).toContain('без ошибок');
    expect(() => run('validate', slug, '--strict')).toThrow();
  });

  it('refuses to overwrite an existing studio', () => {
    expect(() => run('new', 'graphite', '--name', 'Другое')).toThrow();
  });

  it('publishes as a preview, creates the owner and keeps owner edits on republish', async () => {
    const b = loadBusiness(slug).business!;
    const admin = serviceClient();
    const first = await publishTenant(admin, b);
    expect(first).toMatchObject({ status: 'preview', created: true });
    expect(first.uploaded).toBe(5); // logo + hero + 3 works

    const email = `${slug}@owner.example`;
    const owner = await ensureOwner(admin, slug, email, { password: 'integration-pass-123' });
    expect(owner.created).toBe(true);

    const page = await anonClient().rpc('get_public_tenant', { p_slug: slug });
    expect(page.data).toMatchObject({ ok: true, tenant: { status: 'preview', timezone: 'Europe/Samara', accent_color: '#22C55E' } });

    const client = await ownerClient(email, 'integration-pass-123');
    const edit = await client.rpc('owner_update_profile', { p_slug: slug, p_patch: { tagline: 'Слоган от владельца' } });
    expect(edit.error).toBeNull();

    // Operator edits business.json (new price + tagline) and republishes.
    const file = join(dir, 'business.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.tagline = 'Слоган из конфига v2';
    json.services[0].price = 2900;
    writeFileSync(file, JSON.stringify(json, null, 2));
    const again = await publishTenant(admin, loadBusiness(slug).business!);
    expect(again.created).toBe(false);
    expect(again.config_version).toBeGreaterThan(first.config_version);

    const after = await anonClient().rpc('get_public_tenant', { p_slug: slug });
    const data = after.data as { tenant: { tagline: string }; services: Array<{ key: string; price_minor: number }> };
    expect(data.tenant.tagline).toBe('Слоган от владельца');
    expect(data.services.find((s) => s.key === 'wash')?.price_minor).toBe(290000);
    await client.auth.signOut();
  });

  it('a new studio does not affect existing ones', async () => {
    const graphite = await anonClient().rpc('get_public_tenant', { p_slug: 'graphite' });
    expect(graphite.data).toMatchObject({ ok: true, tenant: { slug: 'graphite' } });
  });
});
