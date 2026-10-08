import { z } from 'zod';
import { env } from '@/lib/env';
import { ApiError } from './errors';

export const AssistantReplySchema = z.object({
  reply: z.string(),
  intent: z.string(),
  degraded: z.boolean(),
  mode: z.enum(['tools', 'json', 'template']),
  tool_calls: z.array(z.object({ name: z.string(), label: z.string(), ok: z.boolean() })),
});
export type AssistantReply = z.infer<typeof AssistantReplySchema>;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Calls the `assistant` Edge Function. The function runs the allowed server tools
 * first and only then asks the model; the browser never talks to the LLM directly.
 */
export async function askAssistant(params: {
  scope: 'client' | 'owner';
  slug: string;
  messages: ChatTurn[];
  bookingToken?: string;
  accessToken?: string;
}): Promise<AssistantReply> {
  let res: Response;
  try {
    res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${params.accessToken ?? env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        scope: params.scope,
        slug: params.slug,
        messages: params.messages.slice(-12),
        booking_token: params.bookingToken,
      }),
    });
  } catch {
    throw new ApiError('network', 'Помощник недоступен: нет связи. Запись работает как обычно.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as { error?: string; message?: string } | null;
    throw new ApiError(err?.error ?? 'assistant_unavailable', err?.message ?? 'Помощник временно недоступен. Запись работает как обычно.', res.status);
  }
  const parsed = AssistantReplySchema.safeParse(body);
  if (!parsed.success) throw new ApiError('bad_response', 'Помощник ответил непонятно. Попробуйте ещё раз.');
  return parsed.data;
}
