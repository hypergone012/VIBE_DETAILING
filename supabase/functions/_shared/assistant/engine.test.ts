import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS, parseIntent, runAssistant } from './engine.ts';
import { fakeBackend, NOW, scriptedLlm, text, toolCall } from './fixtures.test-helpers.ts';
import { CLIENT_TOOLS, OWNER_TOOLS, parseToolCall, toolSpecs, ToolRejected } from './tools.ts';
import { LlmError, type LlmMessage } from './types.ts';

const ask = (content: string) => [{ role: 'user' as const, content }];
const toolMessages = (messages: LlmMessage[]) => messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content);

describe('mandatory server tools before the model', () => {
  it('runs the slot tool first and gives its output to the model as tool messages', async () => {
    const backend = fakeBackend('client');
    const llm = scriptedLlm([text('Ближайшее окно — завтра в 10:00.')]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Когда ближайшее окно?'), backend, llm: llm.port, now: NOW });

    expect(backend.rec.calls[0]).toMatch(/^slots:/);
    const first = llm.requests[0]!;
    const tools = toolMessages(first.messages);
    expect(tools).toHaveLength(1);
    expect(JSON.parse(tools[0]!)).toMatchObject({ first_free_day: 'завтра', times_on_first_free_day: ['10:00', '10:30'] });
    // The tool output precedes the model's first word.
    expect(first.messages.at(-1)?.role).toBe('tool');
    expect(reply).toMatchObject({ mode: 'tools', degraded: false, intent: 'next_slot' });
    expect(reply.tool_calls.map((c) => c.name)).toEqual(['next_free_slots']);
  });

  it('answers from a template with real data when no model is configured', async () => {
    const reply = await runAssistant({ scope: 'client', messages: ask('Сколько стоит полировка кузова?'), backend: fakeBackend('client'), llm: null, now: NOW });
    expect(reply).toMatchObject({ mode: 'template', degraded: true, intent: 'price' });
    expect(reply.reply).toContain('Полировка кузова');
    expect(reply.reply).toMatch(/от\s18\s000\s₽/);
  });

  it('asks a clarifying question when the service is ambiguous', async () => {
    const reply = await runAssistant({ scope: 'client', messages: ask('Сколько стоит защита?'), backend: fakeBackend('client'), llm: null, now: NOW });
    expect(reply.reply).toMatch(/Какая именно/);
  });

  it('falls back to the template when the model is down — booking never depends on it', async () => {
    const llm = scriptedLlm([new LlmError('upstream 503', 503, false)]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Когда ближайшее окно?'), backend: fakeBackend('client'), llm: llm.port, now: NOW });
    expect(reply).toMatchObject({ mode: 'template', degraded: true });
    expect(reply.reply).toMatch(/завтра: 10:00, 10:30/);
  });
});

describe('bounded tool loop', () => {
  it('executes a tool the model asks for and returns its answer', async () => {
    const llm = scriptedLlm([toolCall('service_price', { service: 'керамика' }), text('Керамика — от 35 000 ₽.')]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Расскажите про защиту кузова'), backend: fakeBackend('client'), llm: llm.port, now: NOW });
    expect(reply.reply).toBe('Керамика — от 35 000 ₽.');
    expect(reply.tool_calls.map((c) => c.name)).toContain('service_price');
    const second = llm.requests[1]!;
    expect(JSON.parse(toolMessages(second.messages).at(-1)!)).toMatchObject({ match: { name: 'Керамическое покрытие' } });
  });

  it(`stops after ${MAX_ROUNDS} rounds and withholds tools on the last one`, async () => {
    const llm = scriptedLlm(Array.from({ length: 10 }, (_, i) => toolCall('list_services', {}, `c${i}`)));
    const reply = await runAssistant({ scope: 'client', messages: ask('Какие услуги?'), backend: fakeBackend('client'), llm: llm.port, now: NOW });
    expect(llm.requests).toHaveLength(MAX_ROUNDS);
    expect(llm.requests.at(-1)!.tools).toBeUndefined();
    expect(reply.degraded).toBe(true);
    expect(reply.reply).toMatch(/Услуги и цены/);
  });
});

describe('scopes', () => {
  it('client and owner tool lists are separate', () => {
    expect(CLIENT_TOOLS).not.toContain('owner_stats');
    expect(CLIENT_TOOLS).not.toContain('owner_schedule');
    expect(toolSpecs('client').map((t) => t.function.name)).toEqual(CLIENT_TOOLS);
    expect(OWNER_TOOLS).not.toContain('my_booking');
  });

  it('refuses owner tools requested from the client chat without touching owner data', async () => {
    const backend = fakeBackend('owner'); // even if a backend could read owner data…
    const llm = scriptedLlm([toolCall('owner_stats', { period: 'this_month' }), text('Не могу это показать.')]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Сколько денег у студии?'), backend, llm: llm.port, now: NOW });
    expect(backend.rec.calls.some((c) => c.startsWith('stats'))).toBe(false);
    expect(JSON.parse(toolMessages(llm.requests[1]!.messages).at(-1)!)).toEqual({ error: 'Инструмент «owner_stats» недоступен в этом режиме' });
    expect(reply.tool_calls.map((c) => c.name)).not.toContain('owner_stats');
  });

  it('validates arguments: no free-form SQL, tenant or unknown period', () => {
    expect(() => parseToolCall('owner', 'owner_stats', { period: 'all_time' })).toThrow(ToolRejected);
    expect(() => parseToolCall('owner', 'owner_stats', {})).toThrow(ToolRejected);
    expect(parseToolCall('owner', 'owner_stats', { period: 'today', tenant_id: 'x', sql: 'select 1' }).args).toEqual({ period: 'today' });
    expect(() => parseToolCall('client', 'next_free_slots', { date: '10.10.2026' })).toThrow(ToolRejected);
  });

  it('owner: schedule for «завтра» and money that never calls planned value revenue', async () => {
    const backend = fakeBackend('owner');
    const schedule = await runAssistant({ scope: 'owner', messages: ask('Что у меня завтра?'), backend, llm: null, now: NOW });
    expect(backend.rec.calls).toContain('schedule:tomorrow');
    expect(schedule.reply).toMatch(/записей 1.*Детейлинг-мойка — Анна, Skoda Octavia/);
    expect(schedule.reply).not.toContain('Лебедева');

    const money = await runAssistant({ scope: 'owner', messages: ask('Сколько денег получено?'), backend, llm: null, now: NOW });
    expect(backend.rec.calls).toContain('stats:this_week');
    expect(money.reply).toMatch(/получено 41\s500\s₽/);
    expect(money.reply).toMatch(/не выручка/);
  });
});

describe('JSON-intent fallback (providers without tool calling)', () => {
  it('switches to JSON mode, runs the requested tool and returns the JSON answer', async () => {
    const llm = scriptedLlm([
      new LlmError('400 tools are not supported by this model', 400, true),
      text('{"tool": "service_price", "args": {"service": "полировка"}}'),
      text('```json\n{"answer": "Полировка кузова — от 18 000 ₽."}\n```'),
    ]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Сколько стоит?'), backend: fakeBackend('client'), llm: llm.port, now: NOW });
    expect(reply).toMatchObject({ mode: 'json', degraded: false, reply: 'Полировка кузова — от 18 000 ₽.' });
    expect(llm.requests[1]!.json).toBe(true);
    expect(llm.requests[1]!.tools).toBeUndefined();
    expect(reply.tool_calls.map((c) => c.name)).toEqual(['list_services', 'service_price']);
  });

  it('uses the template when the JSON is unusable, and never runs a disallowed tool', async () => {
    const backend = fakeBackend('owner');
    const llm = scriptedLlm([
      new LlmError('tools unsupported', 422, true),
      text('{"tool": "owner_stats", "args": {"period": "today"}}'),
      text('не json'),
    ]);
    const reply = await runAssistant({ scope: 'client', messages: ask('Когда ближайшее окно?'), backend, llm: llm.port, now: NOW });
    expect(reply).toMatchObject({ mode: 'json', degraded: true });
    expect(backend.rec.calls.some((c) => c.startsWith('stats'))).toBe(false);
  });

  it('parses JSON intents strictly', () => {
    expect(parseIntent('{"answer":"ok"}')).toEqual({ answer: 'ok' });
    expect(parseIntent('Ответ: {"tool":"list_services"}')).toEqual({ tool: 'list_services', args: {} });
    expect(parseIntent('{"answer":""}')).toBeNull();
    expect(parseIntent('[1,2]')).toBeNull();
    expect(parseIntent(null)).toBeNull();
  });
});
