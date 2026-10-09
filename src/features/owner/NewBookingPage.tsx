import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { ArrowLeft } from '@phosphor-icons/react';
import { humanError } from '@/api/errors';
import { PageFrame } from '@/components/PageFrame';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { SectionHeader } from '@/components/SectionHeader';
import { formatDuration, formatMoney, formatSlotLong } from '@/lib/format';
import { ownerKeys, useOwner } from './OwnerContext';
import { SlotPicker } from './SlotPicker';

const ANY = 'any';

/** Manual booking (phone call, walk-in). Price and duration come from the service on the server. */
export function NewBookingPage() {
  const { slug, api, session, base } = useOwner();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ownerKeys.settings(slug), queryFn: () => api.settings() });
  const [serviceId, setServiceId] = useState('');
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState(ANY);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [plate, setPlate] = useState('');
  const [comment, setComment] = useState('');
  const [note, setNote] = useState('');
  // Same key while the form is unchanged: a retried submit cannot create a second booking.
  const keyRef = useRef<{ payload: string; key: string } | null>(null);

  const services = useMemo(() => settings.data?.services.filter((s) => s.is_active) ?? [], [settings.data]);
  const service = services.find((s) => s.id === serviceId);
  const resources = settings.data?.resources.filter((r) => r.is_active && service?.resource_ids.includes(r.id)) ?? [];

  const create = useMutation({
    mutationFn: () => {
      const customer = { name, phone, car, plate: plate || undefined, comment: comment || undefined, owner_note: note || undefined };
      const payload = JSON.stringify([serviceId, startsAt, resourceId, customer]);
      if (keyRef.current?.payload !== payload) keyRef.current = { payload, key: crypto.randomUUID() };
      return api.createBooking(serviceId, startsAt!, customer, resourceId === ANY ? null : resourceId, keyRef.current.key);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      navigate(`${base}/booking/${res.booking.id}`, { state: { accessToken: res.access_token, created: true } });
    },
  });

  const missing = !serviceId ? 'Выберите услугу' : !startsAt ? 'Выберите время' : !name.trim() || !phone.trim() || !car.trim() ? 'Заполните имя, телефон и машину' : null;

  return (
    <PageFrame width={760}>
      <VStack gap={8} paddingBlockStart={4}>
        <HStack>
          <Button label="К записям" variant="ghost" size="sm" icon={<ArrowLeft weight="bold" />} href={`${base}/`} />
        </HStack>
        <SectionHeader level={1} size="page" eyebrow={session.name} title="Новая запись" description="Для записи по телефону или клиента, который приехал без записи." />

        {settings.isPending ? <LoadingRows rows={3} label="Загружаем услуги" /> : null}
        {settings.isError ? <ErrorState error={settings.error} onRetry={() => void settings.refetch()} /> : null}

        {settings.data ? (
          <>
            <VStack gap={3}>
              <Heading level={2}>1. Услуга</Heading>
              <Selector
                label="Услуга"
                isLabelHidden
                placeholder="Выберите услугу"
                hasSearch={services.length > 8}
                searchPlaceholder="Поиск услуги"
                presentation="adaptive"
                value={serviceId}
                onChange={(v) => {
                  setServiceId(v);
                  setStartsAt(null);
                  setResourceId(ANY);
                }}
                options={services.map((s) => ({
                  value: s.id,
                  label: s.name,
                  description: `${formatDuration(s.duration_minutes)} · ${formatMoney(s.price_minor, session.currency, s.price_is_from)}`,
                }))}
                width="100%"
              />
            </VStack>

            {service ? (
              <VStack gap={3}>
                <Heading level={2}>2. Время</Heading>
                <SlotPicker serviceId={service.id} value={startsAt} onChange={setStartsAt} />
                {resources.length > 1 ? (
                  <Selector
                    label="Бокс"
                    value={resourceId}
                    onChange={setResourceId}
                    options={[{ value: ANY, label: 'Любой свободный' }, ...resources.map((r) => ({ value: r.id, label: r.name }))]}
                    width="100%"
                  />
                ) : null}
              </VStack>
            ) : null}

            {service && startsAt ? (
              <VStack gap={3}>
                <Heading level={2}>3. Клиент</Heading>
                <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={3}>
                  <TextInput label="Имя" value={name} onChange={setName} autoComplete="off" isRequired />
                  <TextInput label="Телефон" value={phone} onChange={setPhone} placeholder="+7 900 000-00-00" autoComplete="off" isRequired />
                  <TextInput label="Машина" value={car} onChange={setCar} placeholder="Марка и модель" isRequired />
                  <TextInput label="Госномер" value={plate} onChange={setPlate} isOptional />
                </Grid>
                <TextArea label="Пожелания клиента" value={comment} onChange={setComment} isOptional rows={2} />
                <TextArea label="Заметка студии" description="Видна только в кабинете" value={note} onChange={setNote} isOptional rows={2} />
              </VStack>
            ) : null}

            {service && startsAt ? (
              <Card padding={5} elevation="low">
                <VStack gap={3}>
                  <Text weight="semibold">{service.name}</Text>
                  <Text color="secondary" hasTabularNumbers>
                    {formatSlotLong(startsAt, session.timezone)} · {formatDuration(service.duration_minutes)}
                    {service.buffer_minutes ? ` + ${formatDuration(service.buffer_minutes)} подготовка` : ''}
                  </Text>
                  <Text weight="semibold" hasTabularNumbers>
                    {formatMoney(service.price_minor, session.currency, service.price_is_from)}
                  </Text>
                  {create.isError ? <Banner status="error" title="Запись не создана" description={humanError(create.error)} /> : null}
                  <Button
                    label="Записать клиента"
                    variant="primary"
                    size="lg"
                    width="100%"
                    isDisabled={Boolean(missing)}
                    isLoading={create.isPending}
                    onClick={() => create.mutate()}
                  />
                  {missing ? (
                    <Text type="supporting" color="secondary">
                      {missing}
                    </Text>
                  ) : null}
                </VStack>
              </Card>
            ) : null}
          </>
        ) : null}
      </VStack>
    </PageFrame>
  );
}
