/**
 * Generates a VAPID key pair for Web Push.
 *   pnpm push:vapid
 * Put VITE_VAPID_PUBLIC_KEY in the frontend env (public), and VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY / VAPID_SUBJECT in Supabase Edge Function secrets (server only).
 */
import { randomBytes } from 'node:crypto';
import { generateVapidKeys } from '../../supabase/functions/_shared/push/webpush.ts';

const keys = await generateVapidKeys();
console.log('# Frontend (.env / hosting env) — public');
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log('');
console.log('# Supabase secrets (supabase secrets set …) — keep private');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:owner@example.com');
console.log(`DISPATCH_SECRET=${randomBytes(24).toString('base64url')}`);
