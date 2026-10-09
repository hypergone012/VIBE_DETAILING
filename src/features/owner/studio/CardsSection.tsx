import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { InfoCard } from '@/api/ownerSchemas';
import { useOwner } from '../OwnerContext';
import { SaveBar } from './ProfileSection';
import { useSettings, useSettingsMutation } from './useSettings';

const ICONS = [
  { value: 'sparkle', label: 'Блеск' },
  { value: 'shield', label: 'Щит' },
  { value: 'clock', label: 'Часы' },
  { value: 'drop', label: 'Капля' },
  { value: 'car', label: 'Машина' },
  { value: 'star', label: 'Звезда' },
  { value: 'wrench', label: 'Ключ' },
  { value: 'medal', label: 'Медаль' },
  { value: 'coffee', label: 'Кофе' },
  { value: 'camera', label: 'Камера' },
];

const EMPTY: InfoCard = { title: '', text: '', icon: 'sparkle' };

/** Exactly three cards on the studio page (validated in SQL: title ≤ 40, text ≤ 160). */
export function CardsSection() {
  const { api } = useOwner();
  const saved = useSettings().data!.tenant.info_cards;
  const initial = [0, 1, 2].map((i) => saved[i] ?? EMPTY);
  const [cards, setCards] = useState<InfoCard[]>(initial);
  const save = useSettingsMutation((c: InfoCard[]) => api.setInfoCards(c), 'Карточки сохранены');
  const changed = cards.filter((c, i) => JSON.stringify(c) !== JSON.stringify(initial[i])).length;
  const valid = cards.every((c) => c.title.trim() && c.text.trim() && c.title.length <= 40 && c.text.length <= 160);
  const update = (i: number, patch: Partial<InfoCard>) => setCards((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <VStack gap={6}>
      <Grid columns={{ minWidth: 260, repeat: 'fit' }} gap={4}>
        {cards.map((c, i) => (
          <Card key={i} padding={4}>
            <VStack gap={3}>
              <Text weight="semibold">Карточка {i + 1}</Text>
              <TextInput label="Заголовок" value={c.title} onChange={(v) => update(i, { title: v })} status={c.title.length > 40 ? { type: 'error', message: 'До 40 символов' } : undefined} />
              <TextArea label="Текст" value={c.text} onChange={(v) => update(i, { text: v })} rows={3} maxLength={160} />
              <Selector label="Значок" value={c.icon} onChange={(v) => update(i, { icon: v })} options={ICONS} width="100%" />
            </VStack>
          </Card>
        ))}
      </Grid>
      <SaveBar count={changed} isLoading={save.isPending} isDisabled={!valid} onSave={() => save.mutate(cards)} onReset={() => setCards(initial)} />
    </VStack>
  );
}
