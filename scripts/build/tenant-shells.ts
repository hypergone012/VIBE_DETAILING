/**
 * Post-build step: one shared JS/CSS bundle in dist/assets, plus for every studio
 * folder in tenants/:
 *   dist/s/{slug}/index.html                client shell (studio metadata)
 *   dist/s/{slug}/owner/index.html          owner cabinet shell (noindex)
 *   dist/s/{slug}/manifest.webmanifest      client app (id/start_url/scope = /s/{slug}/)
 *   dist/s/{slug}/manifest-owner.webmanifest cabinet app (scope /s/{slug}/owner/)
 *   dist/s/{slug}/icons/*, startup/*        icons, maskable icon, apple-touch-icon, launch screens
 *   dist/s/{slug}/sw.js                     service worker with the studio's scope
 * and host rules (_redirects/_headers for Cloudflare Pages; vercel.json is static).
 *
 * Adding a studio = adding a folder; previous studios are rebuilt unchanged.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv } from 'vite';
import { pwaAssets } from '../tenant/images.ts';
import { listTenantSlugs, printReport, ROOT, validateTenant } from '../tenant/load.ts';
import { cloudflareHeaders, cloudflareRedirects, contentSecurityPolicy, HEAD_MARKER, manifest, renderShell } from '../tenant/shell.ts';

const DIST = join(ROOT, 'dist');

function write(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export async function buildTenantShells(options: { dist?: string; quiet?: boolean } = {}): Promise<string[]> {
  const dist = options.dist ?? DIST;
  const templatePath = join(dist, 'index.html');
  const template = readFileSync(templatePath, 'utf8');
  if (!template.includes(HEAD_MARKER)) throw new Error('dist/index.html: marker missing — was it already processed?');
  // Same env resolution as the client build (.env, .env.local, .env.production, process env).
  const env = { ...loadEnv('production', ROOT, ''), ...process.env };
  const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
  const siteUrl = env.PUBLIC_SITE_URL;
  if (!supabaseUrl) console.warn('! VITE_SUPABASE_URL is empty: CSP will not allow the API host');

  const swPath = join(dist, 'sw.js');
  if (!existsSync(swPath)) throw new Error('dist/sw.js missing — vite-plugin-pwa did not build the service worker');

  const built: string[] = [];
  for (const slug of listTenantSlugs()) {
    const report = await validateTenant(slug);
    if (report.errors.length || !report.business) {
      printReport(report);
      throw new Error(`tenants/${slug}: business.json has errors (pnpm tenant:validate ${slug})`);
    }
    const b = report.business;
    const out = join(dist, 's', slug);
    write(join(out, 'index.html'), renderShell(template, b, 'client', { supabaseUrl, siteUrl }));
    write(join(out, 'owner', 'index.html'), renderShell(template, b, 'owner', { supabaseUrl, siteUrl }));
    write(join(out, 'manifest.webmanifest'), JSON.stringify(manifest(b, 'client'), null, 2));
    write(join(out, 'manifest-owner.webmanifest'), JSON.stringify(manifest(b, 'owner'), null, 2));
    for (const asset of await pwaAssets(report.business ? join(ROOT, 'tenants', slug) : '', b)) {
      write(join(out, asset.file), asset.buffer);
    }
    copyFileSync(swPath, join(out, 'sw.js'));
    built.push(slug);
    if (!options.quiet) console.log(`✓ shell /s/${slug}/ — ${b.name}`);
  }

  // Neutral root: no studio list (studios are private links), noindex.
  const neutralHead = [
    '<meta name="robots" content="noindex, nofollow" />',
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(supabaseUrl).replace(/"/g, '&quot;')}" />`,
    '<script id="tenant-boot" type="application/json">{"app":"none"}</script>',
  ].join('\n    ');
  const neutral = template.replace(HEAD_MARKER, neutralHead);
  write(templatePath, neutral);
  write(join(dist, '404.html'), neutral);
  write(join(dist, '_redirects'), cloudflareRedirects());
  write(join(dist, '_headers'), cloudflareHeaders());
  return built;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildTenantShells()
    .then((slugs) => console.log(`Studios built: ${slugs.length} (${slugs.join(', ')})`))
    .catch((error: unknown) => {
      console.error(`✗ ${(error as Error).message}`);
      process.exit(1);
    });
}
