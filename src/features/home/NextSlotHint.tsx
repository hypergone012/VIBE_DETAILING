import { useQuery } from '@tanstack/react-query';
import { HStack } from '@astryxdesign/core/HStack';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Clock } from '@phosphor-icons/react';
import { publicApi } from '@/api/publicApi';
import { slotsQueryKey } from '@/features/booking/TimeStep';
import { useTenant } from '@/features/tenant/TenantRoot';
import { formatSlotLong } from '@/lib/format';

/** Nearest free time for the first bookable service — real slots, not a guess. */
export function NextSlotHint({ compact = false }: { compact?: boolean }) {
  const { slug, data } = useTenant();
  const service = data.services.find((s) => s.bookable);
  const query = useQuery({
    queryKey: service ? slotsQueryKey(slug, service.id) : ['slots', slug, 'none'],
    queryFn: () => publicApi.slots(slug, service!.id, null, 14),
    enabled: Boolean(service),
    staleTime: 30_000,
  });
  if (!service) return null;
  if (query.isPending) return <Skeleton width={compact ? 200 : 240} height={20} />;
  if (query.isError) return null;
  const next = query.data.days.flatMap((d) => d.slots).find((s) => s.available);
  const when = next ? formatSlotLong(next.starts_at, data.tenant.timezone) : null;

  return (
    <HStack gap={2} vAlign="center">
      <Clock size={16} weight="bold" aria-hidden className="icon-accent" />
      {compact ? (
        <Text type="supporting" color="secondary">
          {when ? (
            <>
              Ближайшее окно — <Text type="supporting" weight="semibold" color="primary" hasTabularNumbers>{when}</Text>
            </>
          ) : (
            'Ближайшие две недели заняты — позвоните в студию'
          )}
        </Text>
      ) : (
        <Text color="secondary">
          {when ? (
            <>
              Ближайшее окно на «{service.name}»:{' '}
              <Text weight="semibold" color="primary" hasTabularNumbers>
                {when}
              </Text>
            </>
          ) : (
            'На ближайшие две недели всё занято — позвоните в студию.'
          )}
        </Text>
      )}
    </HStack>
  );
}
