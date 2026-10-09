import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import OpenAI from 'openai';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleAssistant, type HandlerEnv } from '../../supabase/functions/_shared/assistant/handler.ts';
import { openAiPort } from '../../supabase/functions/_shared/assistant/openaiAdapter.ts';
import { demoOwnerPassword } from '../../scripts/tenant/seed.ts';
import { DB_URL } from '../db/helpers.ts';
import { apiEnv, ownerClient } from './env.ts';

/**
 * The assistant handler against the real local stack (Kong → PostgREST with the
 * demo studios) and the real OpenAI SDK talking to a fake OpenAI-compatible
 * server. Verifies: tools run before the model with real data, scopes, owner
 * auth, the JSON-intent fallback, degraded mode and the atomic rate limit.
 */
type Reply = { status: number; body: Record<string, unknown> };
type Scripted = { status?: number; body: Record<string, unknown> };

let server: Server;
let llmUrl = '';
const queue: Scripted[] = [];
const seen: Record<string, unknown>[] = [];
const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });

const completion = (message: Record<string, unknown>, total = 120): Scripted => ({
  body: {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'fake-model',
    choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: 'stop' }],
    usage: { prompt_tokens: total - 20, completion_tokens: 20, total_tokens: total },
  },
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    seen.push(body);
    const next = queue.shift() ?? { status: 500, body: { error: { message: 'no scripted response' } } };
    res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  llmUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  queue.length = 0;
  seen.length = 0;
  await pool.query("delete from private.rate_counters where bucket like 'assistant:%'");
});

function handlerEnv(withLlm: boolean): HandlerEnv {
  const e = apiEnv();
  return {
    supabaseUrl: e.supabaseUrl,
    anonKey: e.publishableKey,
    serviceKey: e.serviceKey,
    llm: withLlm ? openAiPort(OpenAI, { baseURL: llmUrl, apiKey: 'test-key', model: 'fake-model', timeoutMs: 5000 }) : null,
  };
}

async function ask(body: Record<string, unknown>, opts: { llm?: boolean; jwt?: string; ip?: string } = {}): Promise<Reply> {
  const res = await handleAssistant(
    new Request('http://edge.local/functions/v1/assistant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': opts.ip ?? '198.51.100.77',
        ...(opts.jwt ? { authorization: `Bearer ${opts.jwt}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    handlerEnv(opts.llm ?? true),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const user = (content: string) => [{ role: 'user', content }];
const toolOutputs = (request: Record<string, unknown>) =>
  (request.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content) as Record<string, unknown>);

describe('assistant: client scope', () => {
  it('gives the model real free slots from the database before it answers', async () => {
    queue.push(completion({ content: 'Ближайшее окно — по данным студии.' }));
    const r = await ask({ scope: 'client', slug: 'graphite', messages: user('Когда ближайшее окно?') });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'tools', degraded: false, intent: 'next_slot', reply: 'Ближайшее окно — по данным студии.' });
    const request = seen[0]!;
    expect(request.model).toBe('fake-model');
    expect((request.tools as { function: { name: string } }[]).map((t) => t.function.name)).not.toContain('owner_stats');
    const [slots] = toolOutputs(request);
    expect(slots).toMatchObject({ service: 'Детейлинг-мойка', nothing_free: false });
    expect((slots!.times_on_first_free_day as string[]).length).toBeGreaterThan(0);
  });

  it('runs a tool the model requests through the SDK and refuses owner tools', async () => {
    queue.push(
      completion({
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'service_price', arguments: '{"service":"полировка"}' } },
          { id: 'c2', type: 'function', function: { name: 'owner_stats', arguments: '{"period":"this_month"}' } },
        ],
      }),
    );
    queue.push(completion({ content: 'Полировка кузова — от 18 000 ₽.' }));
    const r = await ask({ scope: 'client', slug: 'graphite', messages: user('Расскажите про услуги') });
    expect(r.body.reply).toBe('Полировка кузова — от 18 000 ₽.');
    const outputs = toolOutputs(seen[1]!);
    expect(outputs).toContainEqual(expect.objectContaining({ match: expect.objectContaining({ name: 'Полировка кузова', price: expect.stringMatching(/^от 18\s000\s₽$/) }) }));
    expect(outputs).toContainEqual({ error: 'Инструмент «owner_stats» недоступен в этом режиме' });
  });

  it('uses the JSON-intent fallback when the provider rejects tools', async () => {
    queue.push({ status: 400, body: { error: { message: 'This model does not support tools', type: 'invalid_request_error' } } });
    queue.push(completion({ content: '{"answer":"Работаем с 09:00 до 21:00."}' }));
    const r = await ask({ scope: 'client', slug: 'graphite', messages: user('До скольки вы работаете?') });
    expect(r.body).toMatchObject({ mode: 'json', degraded: false, reply: 'Работаем с 09:00 до 21:00.' });
    expect(seen[1]!.tools).toBeUndefined();
    expect(seen[1]!.response_format).toEqual({ type: 'json_object' });
  });

  it('answers from data when the model is down, and without any model configured', async () => {
    queue.push({ status: 503, body: { error: { message: 'overloaded' } } });
    queue.push({ status: 503, body: { error: { message: 'overloaded' } } });
    const down = await ask({ scope: 'client', slug: 'graphite', messages: user('Сколько стоит химчистка салона?') });
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ mode: 'template', degraded: true });
    expect(down.body.reply).toMatch(/Химчистка салона.*от 9\s000\s₽/);

    const none = await ask({ scope: 'client', slug: 'severny-boks', messages: user('Как вас найти?') }, { llm: false });
    expect(none.body).toMatchObject({ mode: 'template', degraded: true, intent: 'address' });
    expect(none.body.reply).toMatch(/Екатеринбург/);
  });

  it('limits questions per IP with the shared atomic counter', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await ask({ scope: 'client', slug: 'graphite', messages: user('Привет') }, { llm: false, ip: '203.0.113.9' })).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
    const other = await ask({ scope: 'client', slug: 'graphite', messages: user('Привет') }, { llm: false, ip: '203.0.113.10' });
    expect(other.status).toBe(200);
  });

  it('rejects malformed input and unknown studios', async () => {
    expect((await ask({ scope: 'admin', slug: 'graphite', messages: user('x') }, { llm: false })).status).toBe(400);
    expect((await ask({ scope: 'client', slug: 'no-such-studio', messages: user('x') }, { llm: false })).status).toBe(404);
  });
});

describe('assistant: owner scope', () => {
  it('requires a signed-in owner of THIS studio', async () => {
    expect((await ask({ scope: 'owner', slug: 'graphite', messages: user('Что у меня завтра?') }, { llm: false })).status).toBe(401);
    const other = await ownerClient('owner@severny-boks.example', demoOwnerPassword('severny-boks'));
    const jwt = (await other.auth.getSession()).data.session!.access_token;
    const r = await ask({ scope: 'owner', slug: 'graphite', messages: user('Сколько денег получено?') }, { llm: false, jwt });
    expect(r.status).toBe(403);
  });

  it('answers schedule and money questions from SQL in the studio timezone', async () => {
    const owner = await ownerClient('owner@graphite.example', demoOwnerPassword('graphite'));
    const jwt = (await owner.auth.getSession()).data.session!.access_token;
    const { data: stats } = await owner.rpc('owner_stats', { p_slug: 'graphite', p_period: 'this_week' });

    queue.push(completion({ content: 'За неделю получено столько, сколько показал инструмент.' }));
    const r = await ask({ scope: 'owner', slug: 'graphite', messages: user('Сколько денег получено?') }, { jwt });
    expect(r.body).toMatchObject({ intent: 'stats_money', mode: 'tools' });
    const [tool] = toolOutputs(seen[0]!);
    const net = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(
      (stats as { net_received_minor: number }).net_received_minor / 100,
    );
    expect(tool).toMatchObject({ money_received_net: net, visits_cars_arrived: (stats as { visits: number }).visits });
    expect(tool!.planned_value_not_revenue).toBeDefined();
    // The model got owner tools only in the owner scope; nothing that writes data.
    const names = (seen[0]!.tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['owner_schedule', 'owner_stats']));
    expect(names.some((n) => /create|cancel|update|pay|reschedule/.test(n))).toBe(false);

    const tomorrow = await ask({ scope: 'owner', slug: 'graphite', messages: user('Что у меня завтра?') }, { llm: false, jwt });
    expect(tomorrow.body).toMatchObject({ intent: 'schedule', mode: 'template' });
    expect(String(tomorrow.body.reply)).toMatch(/записей|записей нет/);
  });

  it('reconciles the token budget with what the provider reported', async () => {
    const before = await pool.query("select coalesce(sum(tokens),0)::int as t from private.llm_usage_daily where scope_key = 'global'");
    queue.push(completion({ content: 'Ок.' }, 333));
    await ask({ scope: 'client', slug: 'graphite', messages: user('Когда ближайшее окно?') });
    const after = await pool.query("select coalesce(sum(tokens),0)::int as t from private.llm_usage_daily where scope_key = 'global'");
    expect(after.rows[0].t - before.rows[0].t).toBe(333);
  });
});
