import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus } from '@phosphor-icons/react';
import type { ServiceInput } from '@/api/ownerApi';
import type { SettingsService } from '@/api/ownerSchemas';
import { humanError } from '@/api/errors';
import { FormDialog } from '@/components/FormDialog';
import { formatDuration, formatMoney } from '@/lib/format';
import { useOwner } from '../OwnerContext';
import { fromMinor, toMinor } from '../ownerFormat';
import { useSettings, useSettingsMutation } from './useSettings';

/**
 * Price list. A changed price applies to new bookings only: existing bookings keep
 * the price they were made with (stored on the booking).
 */
export function ServicesSection() {
  const { session } = useOwner();
  const data = useSettings().data!;
  const [editing, setEditing] = useState<SettingsService | 'new' | null>(null);

  return (
    <VStack gap={5}>
      <Text color="secondary" textWrap="pretty">
        Новая цена действует для новых записей. У уже записанных клиентов остаётся цена на момент записи.
      </Text>
      <HStack>
        <Button label="Добавить услугу" variant="primary" icon={<Plus weight="bold" />} onClick={() => setEditing('new')} />
      </HStack>
      <List hasDividers density="spacious" edgeCompensation="inline">
        {data.services.map((s) => (
          <ListItem
            key={s.id}
            label={s.name}
            description={`${s.category ? `${s.category} · ` : ''}${formatDuration(s.duration_minutes)}${s.buffer_minutes ? ` + ${formatDuration(s.buffer_minutes)} подготовка` : ''}`}
            endContent={
              <HStack gap={2} vAlign="center">
                {s.is_active ? null : <Token label="скрыта" size="sm" />}
                <Text weight="semibold" hasTabularNumbers>
                  {formatMoney(s.price_minor, session.currency, s.price_is_from)}
                </Text>
              </HStack>
            }
            onClick={() => setEditing(s)}
          />
        ))}
      </List>
      {editing ? <ServiceDialog service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </VStack>
  );
}

function ServiceDialog({ service, onClose }: { service: SettingsService | null; onClose: () => void }) {
  const { api } = useOwner();
  const resources = useSettings().data!.resources;
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState(service?.category ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState<number | null>(service ? fromMinor(service.price_minor) : null);
  const [priceFrom, setPriceFrom] = useState(service?.price_is_from ?? false);
  const [hours, setHours] = useState<number | null>(service ? service.duration_minutes / 60 : 1);
  const [buffer, setBuffer] = useState<number | null>(service?.buffer_minutes ?? 0);
  const [active, setActive] = useState(service?.is_active ?? true);
  const [boxes, setBoxes] = useState<string[]>(service?.resource_ids ?? resources.filter((r) => r.is_active).map((r) => r.id));
  const save = useSettingsMutation((input: ServiceInput) => api.upsertService(input), service ? 'Услуга сохранена' : 'Услуга добавлена');
  const minutes = Math.round((hours ?? 0) * 60);

  return (
    <FormDialog
      isOpen
      tall
      width={560}
      onOpenChange={(open) => !open && onClose()}
      title={service ? 'Услуга' : 'Новая услуга'}
      actions={
        <>
          <Button label="Отмена" variant="secondary" onClick={onClose} />
          <Button
            label="Сохранить"
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!name.trim() || price === null || minutes < 15 || boxes.length === 0}
            onClick={() =>
              save.mutate(
                {
                  id: service?.id,
                  name: name.trim(),
                  category: category.trim() || null,
                  description: description.trim() || null,
                  price_minor: toMinor(price ?? 0),
                  price_is_from: priceFrom,
                  duration_minutes: minutes,
                  buffer_minutes: buffer ?? 0,
                  is_active: active,
                  resource_ids: boxes,
                },
                { onSuccess: onClose },
              )
            }
          />
        </>
      }
    >
      <VStack gap={4}>
        <TextInput label="Название" value={name} onChange={setName} isRequired />
        <TextInput label="Раздел прайса" value={category} onChange={setCategory} placeholder="Например: Кузов" isOptional />
        <TextArea label="Описание" value={description} onChange={setDescription} rows={3} maxLength={400} isOptional />
        <Grid columns={{ minWidth: 180, repeat: 'fit' }} gap={3}>
          <NumberInput label="Цена" units="₽" value={price} onChange={setPrice} min={0} step={100} isWheelEnabled={false} />
          <NumberInput
            label="Длительность"
            units="ч"
            description={minutes >= 15 ? formatDuration(minutes) : 'Минимум 15 минут'}
            value={hours}
            onChange={setHours}
            min={0.25}
            max={336}
            step={0.5}
            isWheelEnabled={false}
          />
          <NumberInput
            label="Подготовка бокса"
            units="мин"
            description="Уборка после машины"
            value={buffer}
            onChange={setBuffer}
            min={0}
            max={1440}
            step={5}
            isIntegerOnly
            isWheelEnabled={false}
          />
        </Grid>
        <Switch label="Цена «от»" description="Окончательная цена после осмотра" value={priceFrom} onChange={setPriceFrom} />
        <Switch label="Показывать клиентам" value={active} onChange={setActive} />
        <CheckboxList label="Где выполняется" description="Запись займёт один из отмеченных боксов" value={boxes} onChange={setBoxes}>
          {resources.map((r) => (
            <CheckboxListItem key={r.id} value={r.id} label={r.is_active ? r.name : `${r.name} (выключен)`} />
          ))}
        </CheckboxList>
        {save.isError ? <Banner status="error" title="Не сохранено" description={humanError(save.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}
