import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
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
    <main className="app-page" id="main" tabIndex={-1}>
      <VStack gap={6} paddingBlockStart={6}>
        <VStack gap={1}>
          <Heading level={1}>Услуги и цены</Heading>
          <Text color="secondary">Цена «от» уточняется после осмотра машины. Время работы уже учтено в записи.</Text>
        </VStack>
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
                      {s.description ? <Text color="secondary">{s.description}</Text> : null}
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text weight="semibold" hasTabularNumbers>
                          {formatMoney(s.price_minor, data.tenant.currency, s.price_is_from)}
                        </Text>
                        <Text type="supporting" color="secondary">
                          · {formatDuration(s.duration_minutes)}
                        </Text>
                      </HStack>
                    </VStack>
                  }
                  endContent={
                    s.bookable ? (
                      <Button label="Записаться" size="sm" variant="secondary" onClick={() => open(s.id)} />
                    ) : (
                      <Text type="supporting" color="secondary">
                        по телефону
                      </Text>
                    )
                  }
                />
              ))}
            </List>
          </VStack>
        ))}
      </VStack>
    </main>
  );
}
