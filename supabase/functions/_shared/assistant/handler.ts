/**
 * HTTP handler of the `assistant` Edge Function, written against the Fetch API
 * only so the same code runs in Supabase Edge Runtime (Deno) and in Node tests.
 *
 * Order of checks: input shape → scope auth (owner: user JWT + membership via
 * owner_session) → per-IP rate limit and daily LLM budget (atomic DB counters,
 * service role) → engine → budget reconciliation with the tokens actually used.
 */
import { clientBackend, ownerBackend, postgrestRpc, RpcError } from './backend.ts';
import { runAssistant } from './engine.ts';
import type { ChatTurn, LlmPort } from './types.ts';

export interface HandlerEnv {
  supabaseUrl: string;
  /** Publishable/anon key: public RPCs and owner RPCs (with the owner JWT). */
  anonKey: string;
  /** Service role / secret key: only for assistant_begin / assistant_finish. */
  serviceKey: string;
  /** null when LLM_BASE_URL/LLM_API_KEY/LLM_MODEL are not configured (template mode). */
  llm: LlmPort | null;
  allowedOrigins?: string[];
}

const RESERVE_TOKENS = 2500;

export function corsHeaders(origin: string | null, allowed?: string[]): Record<string, string> {
  const allow = !allowed?.length || (origin && allowed.includes(origin)) ? (origin ?? '*') : allowed[0]!;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });

/** Client address as seen by the platform proxy (last X-Forwarded-For hop). */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}

interface Body {
  scope: 'client' | 'owner';
  slug: string;
  messages: ChatTurn[];
  booking_token?: string | null;
}

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.scope !== 'client' && b.scope !== 'owner') return null;
  if (typeof b.slug !== 'string' || !/^[a-z0-9-]{1,40}$/.test(b.slug)) return null;
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > 30) return null;
  const messages = b.messages.filter(
    (m): m is ChatTurn =>
      !!m && typeof m === 'object' && ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant') && typeof (m as ChatTurn).content === 'string',
  );
  if (!messages.length || messages.at(-1)!.role !== 'user') return null;
  const token = typeof b.booking_token === 'string' && b.booking_token.length <= 200 ? b.booking_token : null;
  return { scope: b.scope, slug: b.slug, messages, booking_token: token };
}

export async function handleAssistant(req: Request, env: HandlerEnv): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), env.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Только POST' }, 405, cors);

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return json({ error: 'invalid_input', message: 'Неверный запрос к помощнику' }, 400, cors);

  const ip = clientIp(req);
  // Public reads are made on behalf of the visitor: forward their address for the per-IP limits.
  const rpcPublic = postgrestRpc({ url: env.supabaseUrl, apikey: env.anonKey, headers: { 'x-real-ip': ip } });
  const rpcService = postgrestRpc({ url: env.supabaseUrl, apikey: env.serviceKey });

  let backend;
  if (body.scope === 'owner') {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt || jwt === env.anonKey || !jwt.includes('.')) {
      return json({ error: 'not_authenticated', message: 'Войдите в кабинет' }, 401, cors);
    }
    const rpcOwner = postgrestRpc({ url: env.supabaseUrl, apikey: env.anonKey, bearer: jwt });
    try {
      await rpcOwner('owner_session', { p_slug: body.slug });
    } catch (error) {
      const status = error instanceof RpcError && error.status === 401 ? 401 : 403;
      return json({ error: status === 401 ? 'not_authenticated' : 'forbidden', message: 'Нет доступа к этой студии' }, status, cors);
    }
    backend = ownerBackend(body.slug, rpcPublic, rpcOwner);
  } else {
    backend = clientBackend(body.slug, rpcPublic, body.booking_token);
  }

  // Atomic per-IP rate limit and per-studio/global daily LLM budget.
  let begin: { tenant_id: string; reserved_tokens: number };
  try {
    begin = (await rpcService('assistant_begin', {
      p_slug: body.slug,
      p_scope: body.scope,
      p_client_ip: ip,
      p_reserve_tokens: env.llm ? RESERVE_TOKENS : 0,
    })) as { tenant_id: string; reserved_tokens: number };
  } catch (error) {
    if (error instanceof RpcError && (error.code === 'rate_limited' || error.code === 'budget_exhausted')) {
      return json({ error: error.code, message: error.message }, 429, cors);
    }
    if (error instanceof RpcError && error.code === 'tenant_not_found') return json({ error: error.code, message: error.message }, 404, cors);
    return json({ error: 'assistant_unavailable', message: 'Помощник временно недоступен. Запись работает как обычно.' }, 503, cors);
  }

  try {
    const reply = await runAssistant({ scope: body.scope, messages: body.messages, backend, llm: env.llm });
    await rpcService('assistant_finish', {
      p_tenant_id: begin.tenant_id,
      p_reserved_tokens: begin.reserved_tokens,
      p_used_tokens: reply.used_tokens,
    }).catch(() => undefined);
    const { used_tokens: _used, ...publicReply } = reply;
    return json(publicReply, 200, cors);
  } catch (error) {
    await rpcService('assistant_finish', { p_tenant_id: begin.tenant_id, p_reserved_tokens: begin.reserved_tokens, p_used_tokens: 0 }).catch(
      () => undefined,
    );
    if (error instanceof RpcError) return json({ error: error.code, message: error.message }, error.status >= 400 ? error.status : 502, cors);
    return json({ error: 'assistant_unavailable', message: 'Помощник временно недоступен. Запись работает как обычно.' }, 503, cors);
  }
}
