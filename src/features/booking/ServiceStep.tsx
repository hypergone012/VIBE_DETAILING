import { List } from '@astryxdesign/core/List';
import { ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { CaretRight } from '@phosphor-icons/react';
import type { Service } from '@/api/schemas';
import { formatDuration, formatMoney } from '@/lib/format';

export function ServiceStep({
  services,
  currency,
  selectedId,
  onSelect,
}: {
  services: Service[];
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const bookable = services.filter((s) => s.bookable);
  if (!bookable.length) {
    return <EmptyState title="Онлайн-запись пока недоступна" description="Студия ещё не открыла услуги для записи. Позвоните, пожалуйста." />;
  }
  return (
    <VStack gap={2}>
      <Text color="secondary">Выберите услугу — цена и длительность уже учтены в расписании.</Text>
      <List hasDividers density="spacious" edgeCompensation="inline">
        {bookable.map((s) => (
          <ListItem
            key={s.id}
            label={s.name}
            description={`${formatDuration(s.duration_minutes)} · ${formatMoney(s.price_minor, currency, s.price_is_from)}`}
            isSelected={s.id === selectedId}
            onClick={() => onSelect(s.id)}
            endContent={<CaretRight aria-hidden size={18} />}
          />
        ))}
      </List>
    </VStack>
  );
}
