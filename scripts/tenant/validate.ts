#!/usr/bin/env tsx
/**
 * pnpm tenant:validate [slug ...] [--strict]
 * Checks business.json and images. Without slugs validates every studio folder.
 * --strict is the bar for going live: no demo flag, no placeholders, owner e-mail.
 */
import { parseArgs } from 'node:util';
import { listTenantSlugs, printReport, validateTenant } from './load.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: 'boolean', default: false } },
});

const slugs = positionals.length ? positionals : listTenantSlugs();
if (!slugs.length) {
  console.error('Нет студий в tenants/. Создайте: pnpm tenant:new <slug> --name "Название"');
  process.exit(1);
}

let failed = 0;
for (const slug of slugs) {
  const report = await validateTenant(slug, { strict: values.strict });
  printReport(report);
  if (report.errors.length) failed += 1;
}
console.log(`\n${slugs.length - failed}/${slugs.length} без ошибок${values.strict ? ' (строгая проверка)' : ''}`);
process.exit(failed ? 1 : 0);
