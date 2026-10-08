import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

const NO_RETRY = new Set(['not_found', 'tenant_not_found', 'forbidden', 'not_authenticated', 'invalid_input', 'rate_limited', 'bad_response']);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (count, error) => !(error instanceof ApiError && NO_RETRY.has(error.code)) && count < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
