import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretRight } from '@phosphor-icons/react';
import { PageFrame } from '@/components/PageFrame';
import { SectionHeader } from '@/components/SectionHeader';
import { useBookingRoute } from '@/features/booking/useBookingRoute';
import { useTenant } from '@/features/tenant/TenantRoot';
import { formatDuration, formatMoney } from '@/lib/format';

export function ServicesPage() {
  const { data } = useTenant();
  const { open } = useBookingRoute();
  const services = data.services;
  const groups = new Map<string, typeof services>();
  for (const s of services) {
    const key = s.category ?? 'Услуги';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <PageFrame width={760}>
      <VStack gap={8} paddingBlockStart={4}>
        <SectionHeader
          level={1}
          size="page"
          eyebrow={data.tenant.short_name}
          title="Услуги и цены"
          description="Цена «от» уточняется после осмотра машины. Время работы и подготовки бокса уже учтено в записи."
        />
        {services.length === 0 ? (
          <EmptyState title="Услуги ещё не добавлены" description="Студия скоро опубликует прайс. Позвоните, чтобы записаться." />
        ) : null}
        {[...groups.entries()].map(([category, items]) => (
          <VStack key={category} gap={2}>
            <Heading level={2}>{category}</Heading>
            <List hasDividers density="spacious" edgeCompensation="inline">
              {items.map((s) => (
                <ListItem
                  key={s.id}
                  label={s.name}
                  description={
                    <VStack gap={1}>
                      {s.description ? (
                        <Text color="secondary" textWrap="pretty">
                          {s.description}
                        </Text>
                      ) : null}
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        {formatDuration(s.duration_minutes)}
                        {s.bookable ? '' : ' · запись по телефону'}
                      </Text>
                    </VStack>
                  }
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <Text weight="semibold" hasTabularNumbers>
                        {formatMoney(s.price_minor, data.tenant.currency, s.price_is_from)}
                      </Text>
                      {s.bookable ? <CaretRight size={16} aria-hidden className="icon-secondary" /> : null}
                    </HStack>
                  }
                  onClick={s.bookable ? () => open(s.id) : undefined}
                  aria-label={s.bookable ? `${s.name} — записаться` : undefined}
                />
              ))}
            </List>
          </VStack>
        ))}
      </VStack>
    </PageFrame>
  );
}
