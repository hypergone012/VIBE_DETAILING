import { useMemo, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { SettingsTenant } from '@/api/ownerSchemas';
import { onAccentColor } from '@/theme/studioTheme';
import { useOwner } from '../OwnerContext';
import { useSettings, useSettingsMutation } from './useSettings';

type Draft = Record<string, string>;

const TEXT_FIELDS = [
  'name',
  'short_name',
  'tagline',
  'description',
  'address',
  'address_note',
  'map_url',
  'phone',
  'phone_display',
  'messenger_url',
  'accent_color',
  'hero_alt',
] as const;

function draftOf(t: SettingsTenant): Draft {
  return Object.fromEntries(TEXT_FIELDS.map((k) => [k, (t[k] as string | null) ?? ''])) as Draft;
}

/** Only changed fields are sent; the server records them as owner overrides (kept on republish). */
export function ProfileSection() {
  const { api } = useOwner();
  const settings = useSettings();
  const tenant = settings.data!.tenant;
  const initial = useMemo(() => draftOf(tenant), [tenant]);
  const [draft, setDraft] = useState<Draft>(initial);
  const changed = TEXT_FIELDS.filter((k) => draft[k] !== initial[k]);
  const save = useSettingsMutation((patch: Record<string, string | null>) => api.updateProfile(patch), 'Данные студии сохранены');
  const set = (key: string) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const accentValid = /^#[0-9a-f]{6}$/i.test(draft.accent_color ?? '');

  return (
    <VStack gap={8}>
      <FormBlock title="Название" description="Как студия называется на странице записи и в иконке приложения.">
        <TextInput label="Полное название" value={draft.name!} onChange={set('name')} isRequired />
        <TextInput label="Короткое название" description="Под иконкой на телефоне, до 24 символов" value={draft.short_name!} onChange={set('short_name')} isRequired />
        <TextInput label="Подзаголовок" value={draft.tagline!} onChange={set('tagline')} isOptional />
        <TextArea label="Описание" value={draft.description!} onChange={set('description')} rows={4} maxLength={600} isOptional />
      </FormBlock>
      <FormBlock title="Адрес и связь" description="Помощник отвечает клиентам по этим данным.">
        <TextInput label="Адрес" value={draft.address!} onChange={set('address')} />
        <TextArea label="Как проехать" value={draft.address_note!} onChange={set('address_note')} rows={2} isOptional />
        <TextInput label="Ссылка на карту" placeholder="https://yandex.ru/maps/…" value={draft.map_url!} onChange={set('map_url')} isOptional />
        <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={3}>
          <TextInput label="Телефон" placeholder="+7 900 000-00-00" value={draft.phone!} onChange={set('phone')} />
          <TextInput label="Как показывать" placeholder="+7 (900) 000-00-00" value={draft.phone_display!} onChange={set('phone_display')} isOptional />
        </Grid>
        <TextInput label="Мессенджер" placeholder="https://t.me/…" value={draft.messenger_url!} onChange={set('messenger_url')} isOptional />
      </FormBlock>
      <FormBlock title="Цвет и обложка" description="Один акцентный цвет для кнопок и выделения.">
        <HStack gap={3} vAlign="end">
          <TextInput
            label="Акцентный цвет"
            placeholder="#4690FF"
            value={draft.accent_color!}
            onChange={set('accent_color')}
            status={accentValid ? undefined : { type: 'error', message: 'Цвет в формате #RRGGBB' }}
          />
          {accentValid ? (
            <span className="color-swatch" style={{ background: draft.accent_color, color: onAccentColor(draft.accent_color!) }} aria-hidden>
              Аа
            </span>
          ) : null}
        </HStack>
        <TextInput label="Описание обложки для незрячих" value={draft.hero_alt!} onChange={set('hero_alt')} isOptional />
      </FormBlock>
      {save.isError ? <Banner status="error" title="Не сохранено" description={save.error.message} /> : null}
      <SaveBar
        count={changed.length}
        isLoading={save.isPending}
        isDisabled={!accentValid || !draft.name?.trim() || !draft.short_name?.trim()}
        onSave={() => save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]!.trim() === '' ? null : draft[k]!.trim()])))}
        onReset={() => setDraft(initial)}
      />
    </VStack>
  );
}

export function RulesSection() {
  const { api } = useOwner();
  const t = useSettings().data!.tenant;
  const [step, setStep] = useState(String(t.slot_step_minutes));
  const [lead, setLead] = useState<number | null>(t.min_lead_minutes / 60);
  const [horizon, setHorizon] = useState<number | null>(t.horizon_days);
  const [cancel, setCancel] = useState<number | null>(t.cancel_until_hours);
  const save = useSettingsMutation((patch: Record<string, number>) => api.updateProfile(patch), 'Правила записи сохранены');
  const patch = {
    slot_step_minutes: Number(step),
    min_lead_minutes: Math.round((lead ?? 0) * 60),
    horizon_days: horizon ?? t.horizon_days,
    cancel_until_hours: cancel ?? 0,
  };
  const changed = Object.entries(patch).filter(([k, v]) => t[k as keyof SettingsTenant] !== v);

  return (
    <VStack gap={8}>
      <FormBlock title="Сетка записи" description="Как часто предлагать время начала и насколько заранее можно записаться.">
        <Selector
          label="Шаг времени"
          value={step}
          onChange={setStep}
          options={['10', '15', '20', '30', '60'].map((v) => ({ value: v, label: `${v} мин` }))}
          width="100%"
        />
        <NumberInput label="Не раньше чем через" units="ч" value={lead} onChange={setLead} min={0} max={168} step={0.5} isWheelEnabled={false} />
        <NumberInput label="Записывать вперёд на" units="дней" value={horizon} onChange={setHorizon} min={1} max={180} isIntegerOnly isWheelEnabled={false} />
      </FormBlock>
      <FormBlock title="Отмена клиентом" description="После этого срока клиент сможет отменить запись только звонком.">
        <NumberInput label="Онлайн-отмена не позднее чем за" units="ч" value={cancel} onChange={setCancel} min={0} max={168} isIntegerOnly isWheelEnabled={false} />
      </FormBlock>
      <SaveBar
        count={changed.length}
        isLoading={save.isPending}
        onSave={() => save.mutate(Object.fromEntries(changed))}
        onReset={() => {
          setStep(String(t.slot_step_minutes));
          setLead(t.min_lead_minutes / 60);
          setHorizon(t.horizon_days);
          setCancel(t.cancel_until_hours);
        }}
      />
    </VStack>
  );
}

/** Settings template row: title + description on the left, fields on the right (stacks on phones). */
export function FormBlock({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Grid columns={{ minWidth: 280, repeat: 'fit' }} gap={6}>
      <VStack gap={1}>
        <Text weight="semibold">{title}</Text>
        {description ? (
          <Text type="supporting" color="secondary" textWrap="pretty">
            {description}
          </Text>
        ) : null}
      </VStack>
      <VStack gap={4}>{children}</VStack>
    </Grid>
  );
}

export function SaveBar({
  count,
  isLoading,
  isDisabled = false,
  onSave,
  onReset,
}: {
  count: number;
  isLoading: boolean;
  isDisabled?: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <HStack gap={3} vAlign="center" wrap="wrap" className="save-bar">
      <Button label="Сохранить" variant="primary" isDisabled={count === 0 || isDisabled} isLoading={isLoading} onClick={onSave} />
      {count > 0 ? <Button label="Отменить изменения" variant="ghost" onClick={onReset} /> : null}
      <Text type="supporting" color="secondary">
        {count > 0 ? `Изменено полей: ${count}` : 'Изменений нет'}
      </Text>
    </HStack>
  );
}
