import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { Plus } from '@phosphor-icons/react';
import type { ResourceInput } from '@/api/ownerApi';
import type { SettingsResource } from '@/api/ownerSchemas';
import { humanError } from '@/api/errors';
import { FormDialog } from '@/components/FormDialog';
import { useOwner } from '../OwnerContext';
import { useSettings, useSettingsMutation } from './useSettings';

const KINDS = [
  { value: 'box', label: 'Бокс' },
  { value: 'lift', label: 'Подъёмник' },
  { value: 'bay', label: 'Пост' },
  { value: 'master', label: 'Мастер' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

/** Boxes / lifts: each holds one car at a time; bookings never overlap in one box. */
export function ResourcesSection() {
  const resources = useSettings().data!.resources;
  const [editing, setEditing] = useState<SettingsResource | 'new' | null>(null);
  return (
    <VStack gap={5}>
      <Text color="secondary" textWrap="pretty">
        В одном боксе одновременно может быть только одна машина. Новый бокс сразу доступен для всех услуг — это можно сузить в услуге.
      </Text>
      <HStack>
        <Button label="Добавить бокс" variant="primary" icon={<Plus weight="bold" />} onClick={() => setEditing('new')} />
      </HStack>
      <List hasDividers density="spacious" edgeCompensation="inline">
        {resources.map((r) => (
          <ListItem
            key={r.id}
            label={r.name}
            description={kindLabel(r.kind)}
            endContent={r.is_active ? undefined : <Token label="выключен" size="sm" />}
            onClick={() => setEditing(r)}
          />
        ))}
      </List>
      {editing ? <ResourceDialog resource={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </VStack>
  );
}

function ResourceDialog({ resource, onClose }: { resource: SettingsResource | null; onClose: () => void }) {
  const { api } = useOwner();
  const showToast = useToast();
  const [name, setName] = useState(resource?.name ?? '');
  const [kind, setKind] = useState(resource?.kind ?? 'box');
  const [active, setActive] = useState(resource?.is_active ?? true);
  const save = useSettingsMutation((input: ResourceInput) => api.upsertResource(input), resource ? 'Бокс сохранён' : 'Бокс добавлен');

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={resource ? 'Бокс' : 'Новый бокс'}
      actions={
        <>
          <Button label="Отмена" variant="secondary" onClick={onClose} />
          <Button
            label="Сохранить"
            variant="primary"
            isDisabled={!name.trim()}
            isLoading={save.isPending}
            onClick={() =>
              save.mutate(
                { id: resource?.id, name: name.trim(), kind, is_active: active },
                {
                  onSuccess: (r) => {
                    if (!r.is_active && r.future_bookings > 0) {
                      showToast({ body: `У выключенного бокса остались будущие записи: ${r.future_bookings}. Перенесите их.`, isAutoHide: false });
                    }
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <VStack gap={4}>
        <TextInput label="Название" value={name} onChange={setName} placeholder="Например: Бокс 2" isRequired />
        <Selector label="Тип" value={kind} onChange={setKind} options={KINDS} width="100%" />
        <Switch label="Принимает записи" description="Выключенный бокс не предлагается клиентам" value={active} onChange={setActive} />
        {save.isError ? <Banner status="error" title="Не сохранено" description={humanError(save.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}
