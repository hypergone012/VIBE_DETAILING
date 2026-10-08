#!/usr/bin/env tsx
/**
 * Fails if any studio's business data (name, short name, phone, address, e-mail,
 * slug) appears in src/. Studio data lives only in tenants/ and the database.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listTenantSlugs, loadBusiness, ROOT } from './tenant/load.ts';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html|json)$/.test(f) ? [p] : [];
  });
}

const needles: Array<{ slug: string; value: string }> = [];
for (const slug of listTenantSlugs()) {
  const b = loadBusiness(slug).business;
  if (!b) continue;
  for (const value of [b.name, b.shortName, b.slug, b.contacts.phone, b.contacts.address, b.owner?.email]) {
    if (value && value.length >= 4) needles.push({ slug, value });
  }
}

const hits: string[] = [];
for (const file of [...files(join(ROOT, 'src')), join(ROOT, 'index.html')]) {
  const text = readFileSync(file, 'utf8').toLowerCase();
  for (const n of needles) {
    if (text.includes(n.value.toLowerCase())) hits.push(`${file.slice(ROOT.length + 1)}: "${n.value}" (${n.slug})`);
  }
}
if (hits.length) {
  console.error('✗ Business data found in source code (move it to tenants/<slug>/business.json):');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`✓ src/ has no studio data (${needles.length} values from ${listTenantSlugs().length} studios checked)`);
