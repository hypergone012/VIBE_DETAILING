import { describe, expect, it } from 'vitest';
import { loadBusiness } from './load.ts';
import { cloudflareRedirects, contentSecurityPolicy, HEAD_MARKER, manifest, renderShell, resolveTenantRewrite } from './shell.ts';

const graphite = loadBusiness('graphite').business!;
const other = loadBusiness('severny-boks').business!;

describe('host rewrites', () => {
  it.each([
    ['/s/graphite/', '/s/graphite/index.html'],
    ['/s/graphite/services', '/s/graphite/index.html'],
    ['/s/graphite/my/ABC123', '/s/graphite/index.html'],
    ['/s/graphite/assistant', '/s/graphite/index.html'],
    ['/s/graphite/owner', '/s/graphite/owner/index.html'],
    ['/s/graphite/owner/settings/services', '/s/graphite/owner/index.html'],
    ['/s/graphite/manifest.webmanifest', null],
    ['/s/graphite/icons/icon-192.png', null],
    ['/s/graphite/sw.js', null],
    ['/assets/index.js', null],
  ])('%s → %s', (path, target) => {
    expect(resolveTenantRewrite(path)).toBe(target);
  });

  it('Cloudflare rules list only SPA routes so files are never rewritten', () => {
    const rules = cloudflareRedirects();
    expect(rules).toContain('/s/:slug/owner/* /s/:slug/owner/index.html 200');
    expect(rules).not.toMatch(/\/s\/:slug\/\* /);
  });
});

describe('per-studio manifests', () => {
  it('client and owner apps have distinct ids and nested scopes', () => {
    const client = manifest(graphite, 'client');
    const owner = manifest(graphite, 'owner');
    expect(client).toMatchObject({ id: '/s/graphite/', scope: '/s/graphite/', display: 'standalone' });
    expect(client.start_url.startsWith(client.scope)).toBe(true);
    expect(owner).toMatchObject({ id: '/s/graphite/owner/', scope: '/s/graphite/owner/' });
    expect(owner.start_url.startsWith(owner.scope)).toBe(true);
    expect(client.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('two studios never share an id, scope or icon path', () => {
    const a = manifest(graphite, 'client');
    const b = manifest(other, 'client');
    expect(a.id).not.toBe(b.id);
    expect(a.icons.map((i) => i.src).some((src) => b.icons.map((i) => i.src).includes(src))).toBe(false);
  });
});

describe('shell HTML', () => {
  const template = `<html><head>${HEAD_MARKER}<title>x</title></head><body></body></html>`;

  it('injects studio metadata, escapes text and embeds boot JSON safely', () => {
    const html = renderShell(template, { ...graphite, name: 'A "B" <C>' }, 'client', { supabaseUrl: 'https://abc.supabase.co' });
    expect(html).toContain('<meta name="tenant" content="graphite" />');
    expect(html).toContain('A &quot;B&quot; &lt;C&gt;');
    expect(html).toContain('"name":"A \\"B\\" \\u003cC\\u003e"');
    expect(html).toContain('<link rel="manifest" href="/s/graphite/manifest.webmanifest" />');
    expect(html).toMatch(/apple-touch-startup-image/);
  });

  it('owner shell is noindex and points to the cabinet manifest', () => {
    const html = renderShell(template, graphite, 'owner', { supabaseUrl: '' });
    expect(html).toContain('noindex');
    expect(html).toContain('/s/graphite/manifest-owner.webmanifest');
  });

  it('CSP allows only self and the Supabase origin for data', () => {
    const csp = contentSecurityPolicy('https://abc.supabase.co');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('connect-src \'self\' https://abc.supabase.co wss://abc.supabase.co');
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('vercel.json stays in sync with the app routes', () => {
  it('rewrites every client route prefix and the owner cabinet', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { CLIENT_ROUTE_PREFIXES } = await import('../../src/app/routePaths.ts');
    const { ROOT } = await import('./load.ts');
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { rewrites: Array<{ source: string }> };
    const sources = cfg.rewrites.map((r) => r.source);
    for (const p of CLIENT_ROUTE_PREFIXES) expect(sources).toContain(`/s/:slug/${p}`);
    expect(sources).toContain('/s/:slug/owner/:path*');
  });
});
