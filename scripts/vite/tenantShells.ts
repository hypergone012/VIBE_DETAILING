/**
 * Vite plugin: serves studio shells in `vite dev` and applies the production
 * rewrite rules in `vite preview`, so local URLs behave like the deployed host.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { pwaAssets } from '../tenant/images.ts';
import { loadBusiness, ROOT } from '../tenant/load.ts';
import { HEAD_MARKER, manifest, renderShell, resolveTenantRewrite } from '../tenant/shell.ts';

const assetCache = new Map<string, Map<string, Buffer>>();

async function devAsset(slug: string, file: string): Promise<Buffer | null> {
  let assets = assetCache.get(slug);
  if (!assets) {
    const loaded = loadBusiness(slug);
    if (!loaded.business) return null;
    assets = new Map((await pwaAssets(loaded.dir, loaded.business)).map((a) => [a.file, a.buffer]));
    assetCache.set(slug, assets);
  }
  return assets.get(file) ?? null;
}

export function tenantShells(): Plugin {
  return {
    name: 'tenant-shells',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://local');
          const m = /^\/s\/([a-z0-9-]+)\/(.*)$/.exec(url.pathname);
          if (!m) return next();
          const [, slug, rest] = m as unknown as [string, string, string];
          const loaded = loadBusiness(slug);
          if (!loaded.business) return next();
          if (rest === 'manifest.webmanifest' || rest === 'manifest-owner.webmanifest') {
            res.setHeader('Content-Type', 'application/manifest+json');
            res.end(JSON.stringify(manifest(loaded.business, rest === 'manifest.webmanifest' ? 'client' : 'owner')));
            return;
          }
          if (/^(icons|startup)\//.test(rest)) {
            const buf = await devAsset(slug, rest);
            if (!buf) return next();
            res.setHeader('Content-Type', rest.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
            res.end(buf);
            return;
          }
          const target = resolveTenantRewrite(url.pathname);
          if (!target || !(req.headers.accept ?? '').includes('text/html')) return next();
          const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
          const html = renderShell(template, loaded.business, target.includes('/owner/') ? 'owner' : 'client', {
            supabaseUrl: process.env.VITE_SUPABASE_URL ?? '',
          });
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(await server.transformIndexHtml(url.pathname, html));
        } catch (error) {
          next(error);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const target = resolveTenantRewrite(url.pathname);
        if (target && existsSync(join(ROOT, 'dist', target))) {
          req.url = target + url.search;
        }
        next();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // The production template must keep the marker for scripts/build/tenant-shells.ts.
        if (!ctx.server && !html.includes(HEAD_MARKER)) throw new Error(`index.html must contain ${HEAD_MARKER}`);
        return html;
      },
    },
  };
}
