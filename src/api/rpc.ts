import type { z } from 'zod';
import { ApiError, fromPostgrest } from './errors';

/**
 * Calls a Postgres function and validates the response shape with Zod.
 * Public RPCs answer business errors as {ok:false,error,message}; those become ApiError too.
 */
/** Anything with a PostgREST-style rpc(): PostgrestClient or a full SupabaseClient. */
export interface RpcCapable {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; hint?: string | null; code?: string } | null; status: number }>;
}

export async function callRpc<S extends z.ZodType>(
  client: RpcCapable,
  fn: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  let response;
  try {
    response = await client.rpc(fn, args);
  } catch {
    throw new ApiError('network', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const { data, error, status } = response;
  if (error) throw fromPostgrest(error, status || undefined);
  if (data && typeof data === 'object' && 'ok' in data && (data as { ok: unknown }).ok === false) {
    const env = data as { error?: string; message?: string; field?: string };
    throw new ApiError(env.error ?? 'unknown', env.message ?? 'Ошибка', null, env.field ?? null);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[rpc ${fn}] unexpected response`, parsed.error.issues);
    throw new ApiError('bad_response', 'Сервер вернул неожиданный ответ. Обновите страницу.');
  }
  return parsed.data;
}
