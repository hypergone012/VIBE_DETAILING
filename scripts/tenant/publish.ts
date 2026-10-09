#!/usr/bin/env tsx
/**
 * pnpm tenant:publish <slug> [--live] [--owner-email x@y] [--reset-owner-password]
 *                             [--owner-password ...] [--skip-owner]
 *
 * Validates tenants/<slug>, uploads images to Storage, upserts the studio into the
 * database (bookings, payments, owner photos and owner edits are preserved) and makes
 * sure the owner can sign in. Without --live a new studio stays a preview ("образец"):
 * bookings are marked demo and no notifications are sent. --live runs the strict
 * validation, switches the studio to live and removes preview demo bookings.
 */
import { parseArgs } from 'node:util';
import { adminClient, pipelineEnv } from './env.ts';
import { printReport, validateTenant } from './load.ts';
import { ensureOwner, publishTenant, writePublishRecord } from './publish-core.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    live: { type: 'boolean', default: false },
    'owner-email': { type: 'string' },
    'owner-password': { type: 'string' },
    'reset-owner-password': { type: 'boolean', default: false },
    'skip-owner': { type: 'boolean', default: false },
  },
});

const slug = positionals[0];
if (!slug) {
  console.error('Использование: pnpm tenant:publish <slug> [--live] [--owner-email почта] [--reset-owner-password]');
  process.exit(2);
}

const report = await validateTenant(slug, { strict: values.live });
printReport(report);
if (report.errors.length || !report.business) {
  console.error(values.live ? '\nЗапуск отменён: исправьте ошибки (строгая проверка для live).' : '\nПубликация отменена.');
  process.exit(1);
}
const b = report.business;
const env = pipelineEnv();
const client = adminClient();

console.log(`\nПубликую ${b.slug} в ${env.supabaseUrl}${env.isLocal ? ' (локально)' : ''}…`);
const result = await publishTenant(client, b, { activate: values.live });
console.log(`✓ Студия ${result.created ? 'создана' : 'обновлена'}: статус ${result.status}, версия конфига ${result.config_version}`);
console.log(`✓ Изображений загружено: ${result.uploaded}`);
if (result.purged_demo_bookings) console.log(`✓ Удалены демо-записи образца: ${result.purged_demo_bookings}`);
if (result.owner_overrides.length) {
  console.log(`  Владелец уже менял в кабинете (не перезаписано): ${result.owner_overrides.join(', ')}`);
}
const skippedItems = (result.skipped as Array<{ kind: string; key?: string; items?: unknown[] }>).filter(
  (s) => s.kind !== 'profile_fields',
);
for (const s of skippedItems) console.log(`  Пропущено (изменено владельцем): ${s.kind}${s.key ? ` ${s.key}` : ''}`);

const email = values['owner-email'] ?? b.owner?.email;
let owner: Awaited<ReturnType<typeof ensureOwner>> | null = null;
if (email && !values['skip-owner']) {
  owner = await ensureOwner(client, b.slug, email, {
    resetPassword: values['reset-owner-password'],
    password: values['owner-password'],
  });
  console.log(`✓ Владелец ${owner.email} ${owner.created ? 'создан' : 'уже есть'} и привязан к студии`);
  if (owner.password && !values['owner-password']) {
    console.log(`  Пароль (показывается один раз, передайте владельцу): ${owner.password}`);
  }
} else if (!email) {
  console.log('! owner.email не указан — вход в кабинет не создан');
}

const site = env.siteUrl || '(PUBLIC_SITE_URL не задан)';
console.log(`\nСсылка клиента:   ${site}/s/${b.slug}/`);
console.log(`Кабинет владельца: ${site}/s/${b.slug}/owner/`);
console.log(
  result.status === 'live'
    ? 'Статус: LIVE — записи настоящие, уведомления включены.'
    : 'Статус: ОБРАЗЕЦ — записи помечаются как демо, уведомления не отправляются. Запуск: --live.',
);
console.log('Оболочка (иконка, manifest) попадёт на хостинг при следующем деплое: pnpm deploy:vercel (Vercel соберёт сам) или pnpm deploy:cloudflare.');

const recordFile = writePublishRecord(b.slug, new URL(env.supabaseUrl).host, {
  published_at: new Date().toISOString(),
  supabase_url: env.supabaseUrl,
  tenant_id: result.tenant_id,
  status: result.status,
  config_version: result.config_version,
  owner: owner ? { email: owner.email, user_id: owner.userId } : null,
});
console.log(`Запись о публикации: ${recordFile}`);
