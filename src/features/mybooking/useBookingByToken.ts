import { useQuery } from '@tanstack/react-query';
import { publicApi } from '@/api/publicApi';

export const bookingQueryKey = (slug: string, token: string) => ['booking', slug, token] as const;

/** A client's booking, fetched fresh by its access token (never cached by the service worker). */
export function useBookingByToken(slug: string, token: string | undefined) {
  return useQuery({
    queryKey: bookingQueryKey(slug, token ?? ''),
    queryFn: async () => (await publicApi.booking(slug, token!)).booking,
    enabled: Boolean(token),
    staleTime: 10_000,
  });
}
