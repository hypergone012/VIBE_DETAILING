#!/usr/bin/env node
// Runs the Supabase CLI for local development with environment defaults:
//  * images from Docker Hub when the default registry is unreachable
//    (SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io);
//  * empty values for the env() references in supabase/config.toml so a fresh
//    checkout starts without any secrets (the assistant then runs degraded and
//    push stays disabled — see SETUP.md).
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
env.SUPABASE_INTERNAL_IMAGE_REGISTRY ??= 'docker.io';
for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'DISPATCH_SECRET']) {
  env[key] ??= '';
}
const args = process.argv.slice(2);
if (args[0] === 'start' && !args.includes('-x')) {
  args.push('-x', 'realtime,studio,postgres-meta,logflare,vector,supavisor,imgproxy');
}
const result = spawnSync('supabase', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
