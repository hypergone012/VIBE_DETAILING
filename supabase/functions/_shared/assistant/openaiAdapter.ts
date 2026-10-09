/**
 * LlmPort over the official OpenAI SDK, pointed at any OpenAI-compatible endpoint
 * (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). The SDK class is injected so this file
 * works with `npm:openai` in Deno and `openai` in Node.
 */
import { LlmError, type LlmMessage, type LlmPort, type LlmResponse, type LlmToolSpec } from './types.ts';

interface OpenAILike {
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<{
        choices: { message: { content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] } }[];
        usage?: { total_tokens?: number } | null;
      }>;
    };
  };
}

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/** Null when the model is not configured: the assistant then answers from templates. */
export function llmConfigFromEnv(get: (key: string) => string | undefined): LlmConfig | null {
  const baseURL = get('LLM_BASE_URL')?.trim();
  const apiKey = get('LLM_API_KEY')?.trim();
  const model = get('LLM_MODEL')?.trim();
  if (!baseURL || !apiKey || !model) return null;
  return { baseURL, apiKey, model, timeoutMs: Number(get('LLM_TIMEOUT_MS') ?? 20000) };
}

export function openAiPort(
  OpenAI: new (options: { baseURL: string; apiKey: string; timeout: number; maxRetries: number }) => unknown,
  config: LlmConfig,
): LlmPort {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, timeout: config.timeoutMs ?? 20000, maxRetries: 1 }) as OpenAILike;
  return {
    async complete(req: { messages: LlmMessage[]; tools?: LlmToolSpec[]; json?: boolean }): Promise<LlmResponse> {
      try {
        const res = await client.chat.completions.create({
          model: config.model,
          messages: req.messages,
          temperature: 0.2,
          max_tokens: 600,
          ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto', parallel_tool_calls: true } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        });
        const message = res.choices[0]?.message;
        return {
          content: message?.content ?? null,
          tool_calls: (message?.tool_calls ?? [])
            .filter((c) => c.type === 'function')
            .map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.function.name, arguments: c.function.arguments } })),
          total_tokens: res.usage?.total_tokens ?? 0,
        };
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === 'number' ? ((error as { status: number }).status) : null;
        const text = error instanceof Error ? error.message : String(error);
        // Providers without function calling answer 400/404/422 mentioning tools/functions.
        const toolsUnsupported = Boolean(req.tools?.length) && status !== null && [400, 404, 422].includes(status) && /tool|function/i.test(text);
        // Some providers also reject response_format; treat it like "no JSON mode" on the next try.
        throw new LlmError(text, status, toolsUnsupported);
      }
    },
  };
}
