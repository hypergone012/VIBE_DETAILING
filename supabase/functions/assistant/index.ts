// Supabase Edge Function `assistant` (Deno). All logic lives in ../_shared/assistant
// (Fetch API only, unit-tested in Node); this file wires environment and the SDK.
import OpenAI from 'npm:openai@7.23.0';
import { handleAssistant } from '../_shared/assistant/handler.ts';
import { llmConfigFromEnv, openAiPort } from '../_shared/assistant/openaiAdapter.ts';

const env = (key: string) => Deno.env.get(key);

/** New key names (sb_publishable_/sb_secret_) with a fallback to the legacy JWT keys. */
function firstKey(jsonVar: string, legacyVar: string): string {
  const raw = env(jsonVar);
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const value = keys.default ?? Object.values(keys)[0];
      if (value) return value;
    } catch {
      // not JSON: ignore
    }
  }
  return env(legacyVar) ?? '';
}

const llmConfig = llmConfigFromEnv(env);
const llm = llmConfig ? openAiPort(OpenAI, llmConfig) : null;
const allowedOrigins = (env('ASSISTANT_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

Deno.serve((req) =>
  handleAssistant(req, {
    supabaseUrl: env('SUPABASE_URL') ?? '',
    anonKey: firstKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
    serviceKey: firstKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
    llm,
    allowedOrigins,
  }),
);
