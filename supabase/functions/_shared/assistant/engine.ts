/**
 * Assistant engine.
 *
 * 1. The router picks the intent; the mandatory server tools for it run first.
 * 2. With a model configured: the conversation goes to the model WITH those tool
 *    results as tool outputs, and the model may call more tools of its own scope
 *    in a bounded loop (MAX_ROUNDS rounds, MAX_CALLS_PER_ROUND calls each).
 * 3. If the provider rejects tool calling, a JSON-intent fallback asks for
 *    {"answer"} or {"tool","args"} as JSON and runs at most one extra tool.
 * 4. Without a model, or when it fails, a template answer is built from the same
 *    tool results (degraded = true). Booking never depends on the model.
 */
import { planTools } from './plan.ts';
import { systemPrompt } from './prompt.ts';
import { routeMessage, type Route } from './router.ts';
import { localDate } from './text.ts';
import { parseToolCall, runTool, TOOL_LABELS, toolSpecs, ToolRejected, type ToolContext, type ToolResult } from './tools.ts';
import { LlmError, type AssistantReply, type ChatTurn, type LlmMessage, type LlmPort, type Scope, type ToolBackend } from './types.ts';
import { templateAnswer } from './templates.ts';

export const MAX_ROUNDS = 3;
export const MAX_CALLS_PER_ROUND = 4;
const MAX_REPLY_CHARS = 1200;

export interface AssistantRequest {
  scope: Scope;
  messages: ChatTurn[];
  backend: ToolBackend;
  llm: LlmPort | null;
  now?: Date;
}

export async function runAssistant(req: AssistantRequest): Promise<AssistantReply> {
  const now = req.now ?? new Date();
  const ctx: ToolContext = { scope: req.scope, backend: req.backend, now };
  const history = sanitizeHistory(req.messages);
  const question = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

  const studio = await req.backend.studio();
  const services = await req.backend.services();
  const route = routeMessage({ text: question, scope: req.scope, services, today: localDate(now, studio.timezone) });

  // Mandatory server tools BEFORE any model call.
  const results: ToolResult[] = [];
  for (const call of planTools(route)) results.push(await runTool(ctx, call.name, call.args));

  const base = { intent: route.intent, results };
  if (!req.llm) return finish(base, templateAnswer(route, results), 'template', true, 0);

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(req.scope, studio, now) },
    ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    { role: 'user', content: question },
    ...asToolMessages(results, 'pre'),
  ];

  try {
    return await toolLoop(req.llm, ctx, route, messages, results);
  } catch (error) {
    if (error instanceof LlmError && error.toolsUnsupported) {
      try {
        return await jsonFallback(req.llm, ctx, route, history, studio, now, results);
      } catch {
        return finish(base, templateAnswer(route, results), 'template', true, 0);
      }
    }
    return finish(base, templateAnswer(route, results), 'template', true, 0);
  }
}

async function toolLoop(llm: LlmPort, ctx: ToolContext, route: Route, messages: LlmMessage[], results: ToolResult[]): Promise<AssistantReply> {
  let tokens = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // The last round withholds tools so the model has to answer.
    const response = await llm.complete({ messages, tools: round < MAX_ROUNDS - 1 ? toolSpecs(ctx.scope) : undefined });
    tokens += response.total_tokens;
    if (!response.tool_calls.length) {
      const text = cleanReply(response.content);
      if (text) return finish({ intent: route.intent, results }, text, 'tools', false, tokens);
      break;
    }
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.tool_calls.slice(0, MAX_CALLS_PER_ROUND) });
    for (const call of response.tool_calls.slice(0, MAX_CALLS_PER_ROUND)) {
      let content: string;
      try {
        const parsed = parseToolCall(ctx.scope, call.function.name, safeJson(call.function.arguments));
        const result = await runTool(ctx, parsed.name, parsed.args);
        results.push(result);
        content = JSON.stringify(result.ok ? result.data : { error: result.error });
      } catch (error) {
        // A tool outside the scope (e.g. owner data from the client chat) is refused, not executed.
        content = JSON.stringify({ error: error instanceof ToolRejected ? error.message : 'Ошибка инструмента' });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  // The model kept calling tools or answered nothing: answer from the data we have.
  return finish({ intent: route.intent, results }, templateAnswer(route, results), 'tools', true, tokens);
}

/** For providers without tool calling: the model replies with JSON naming an answer or one tool. */
async function jsonFallback(
  llm: LlmPort,
  ctx: ToolContext,
  route: Route,
  history: ChatTurn[],
  studio: Awaited<ReturnType<ToolBackend['studio']>>,
  now: Date,
  results: ToolResult[],
): Promise<AssistantReply> {
  const allowed = toolSpecs(ctx.scope).map((t) => `${t.function.name}: ${t.function.description}`).join('\n');
  const prompt = (data: ToolResult[]) =>
    `${systemPrompt(ctx.scope, studio, now)}\n\nДанные из инструментов студии (JSON):\n${JSON.stringify(
      data.map((r) => ({ tool: r.name, args: r.args, result: r.ok ? r.data : { error: r.error } })),
    )}\n\nОтветь СТРОГО одним JSON-объектом без пояснений: {"answer": "текст ответа"} — если данных хватает, или {"tool": "имя", "args": {…}} — если нужен ещё один инструмент из списка:\n${allowed}`;

  let tokens = 0;
  const ask = async (data: ToolResult[]) => {
    const response = await llm.complete({
      json: true,
      messages: [{ role: 'system', content: prompt(data) }, ...history.map((m) => ({ role: m.role, content: m.content }) as LlmMessage)],
    });
    tokens += response.total_tokens;
    return parseIntent(response.content);
  };

  let intent = await ask(results);
  if (intent?.tool) {
    try {
      const parsed = parseToolCall(ctx.scope, intent.tool, intent.args);
      results.push(await runTool(ctx, parsed.name, parsed.args));
    } catch {
      // Disallowed or malformed tool request: answer with what we have.
    }
    intent = await ask(results);
  }
  const answer = cleanReply(intent?.answer ?? null);
  if (answer) return finish({ intent: route.intent, results }, answer, 'json', false, tokens);
  return finish({ intent: route.intent, results }, templateAnswer(route, results), 'json', true, tokens);
}

/** JSON-intent parser: tolerant to code fences, strict about the shape. */
export function parseIntent(content: string | null): { answer?: string; tool?: string; args?: Record<string, unknown> } | null {
  if (!content) return null;
  const match = content.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  const value = safeJson(match[0]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.answer === 'string' && v.answer.trim()) return { answer: v.answer };
  if (typeof v.tool === 'string') {
    const args = v.args && typeof v.args === 'object' && !Array.isArray(v.args) ? (v.args as Record<string, unknown>) : {};
    return { tool: v.tool, args };
  }
  return null;
}

function asToolMessages(results: ToolResult[], prefix: string): LlmMessage[] {
  if (!results.length) return [];
  const calls = results.map((r, i) => ({
    id: `${prefix}_${i}`,
    type: 'function' as const,
    function: { name: r.name, arguments: JSON.stringify(r.args) },
  }));
  return [
    { role: 'assistant', content: null, tool_calls: calls },
    ...results.map((r, i) => ({
      role: 'tool' as const,
      tool_call_id: `${prefix}_${i}`,
      content: JSON.stringify(r.ok ? r.data : { error: r.error }),
    })),
  ];
}

function finish(
  base: { intent: string; results: ToolResult[] },
  reply: string,
  mode: AssistantReply['mode'],
  degraded: boolean,
  tokens: number,
): AssistantReply {
  return {
    reply,
    intent: base.intent,
    degraded,
    mode,
    used_tokens: tokens,
    tool_calls: base.results.map((r) => ({ name: r.name, label: TOOL_LABELS[r.name], ok: r.ok })),
  };
}

function sanitizeHistory(messages: ChatTurn[]): ChatTurn[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
}

function cleanReply(content: string | null): string | null {
  if (!content) return null;
  const text = content.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();
  return text ? text.slice(0, MAX_REPLY_CHARS) : null;
}

function safeJson(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
