import { useQuery } from '@tanstack/react-query';
import { HStack } from '@astryxdesign/core/HStack';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Clock } from '@phosphor-icons/react';
import { publicApi } from '@/api/publicApi';
import { slotsQueryKey } from '@/features/booking/TimeStep';
import { useTenant } from '@/features/tenant/TenantRoot';
import { formatSlotLong } from '@/lib/format';

/** "Ближайшее окно" for the first bookable service — real slots, not a guess. */
export function NextSlotHint() {
  const { slug, data } = useTenant();
  const service = data.services.find((s) => s.bookable);
  const query = useQuery({
    queryKey: service ? slotsQueryKey(slug, service.id) : ['slots', slug, 'none'],
    queryFn: () => publicApi.slots(slug, service!.id, null, 14),
    enabled: Boolean(service),
    staleTime: 30_000,
  });
  if (!service) return null;
  if (query.isPending) return <Skeleton width={220} height={20} />;
  if (query.isError) return null;
  const next = query.data.days.flatMap((d) => d.slots).find((s) => s.available);
  return (
    <HStack gap={2} vAlign="center">
      <Clock size={18} weight="bold" color="var(--color-icon-accent)" aria-hidden />
      <Text color="secondary">
        {next ? (
          <>
            Ближайшее окно на «{service.name}»: <Text weight="semibold" color="primary">{formatSlotLong(next.starts_at, data.tenant.timezone)}</Text>
          </>
        ) : (
          'На ближайшие две недели всё занято — позвоните в студию.'
        )}
      </Text>
    </HStack>
  );
}
