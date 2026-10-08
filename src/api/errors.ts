/** Errors from RPCs, normalised to a stable code and a Russian message for people. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly field: string | null;

  constructor(code: string, message: string, status: number | null = null, field: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

const FALLBACK: Record<string, string> = {
  rate_limited: 'Слишком много запросов. Подождите пару минут и попробуйте снова.',
  forbidden: 'Нет доступа к этой студии.',
  not_authenticated: 'Войдите в кабинет.',
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  unknown: 'Что-то пошло не так. Попробуйте ещё раз.',
};

export function messageFor(code: string): string {
  return FALLBACK[code] ?? FALLBACK.unknown!;
}

interface PostgrestLikeError {
  message?: string;
  hint?: string | null;
  code?: string;
  details?: string | null;
}

/** Converts a supabase-js/PostgREST error into ApiError (hint carries our human text). */
export function fromPostgrest(error: PostgrestLikeError, status?: number): ApiError {
  const code = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'unknown';
  const human = error.hint && error.hint !== code ? error.hint : messageFor(code);
  const httpStatus = status ?? (error.code?.startsWith('PT') ? Number(error.code.slice(2)) : null);
  if (!error.code && /fetch|network|Failed/i.test(error.message ?? '')) {
    return new ApiError('network', messageFor('network'));
  }
  return new ApiError(code, human, httpStatus);
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export function humanError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return messageFor('network');
  return messageFor('unknown');
}
