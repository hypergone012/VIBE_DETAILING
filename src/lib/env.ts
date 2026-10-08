import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  VITE_VAPID_PUBLIC_KEY: z.string().optional().default(''),
});

const parsed = EnvSchema.safeParse(import.meta.env);

/** Public build-time configuration. Never contains server secrets. */
export const env = parsed.success
  ? parsed.data
  : { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_VAPID_PUBLIC_KEY: '' };

export const envError: string | null = parsed.success
  ? null
  : 'Приложение не настроено: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY.';
