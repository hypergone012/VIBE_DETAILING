import { z } from 'zod';
import { isOwnerPath, tenantSlugFromPath } from './routePaths';

/**
 * First-paint data embedded by the studio shell (<script id="tenant-boot">):
 * name and accent from business.json, so the right colors show before the API answers.
 * Runtime truth always comes from the database.
 */
const BootSchema = z.object({
  app: z.enum(['client', 'owner', 'none']),
  slug: z.string().optional(),
  name: z.string().optional(),
  shortName: z.string().optional(),
  accent: z.string().optional(),
  demo: z.boolean().optional(),
});
export type Boot = z.infer<typeof BootSchema>;

export function readBoot(): Boot {
  const el = document.getElementById('tenant-boot');
  let parsed: Boot | null = null;
  if (el?.textContent) {
    try {
      const r = BootSchema.safeParse(JSON.parse(el.textContent));
      if (r.success) parsed = r.data;
    } catch {
      parsed = null;
    }
  }
  const pathSlug = tenantSlugFromPath(window.location.pathname);
  if (parsed && parsed.app !== 'none' && parsed.slug === pathSlug) return parsed;
  // Shell missing or mismatched (e.g. dev): derive from the URL only.
  return pathSlug ? { app: isOwnerPath(window.location.pathname) ? 'owner' : 'client', slug: pathSlug } : { app: 'none' };
}
