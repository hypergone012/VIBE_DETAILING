import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarBlank, MapPin, Phone } from '@phosphor-icons/react';
import { publicApi } from '@/api/publicApi';
import { humanError } from '@/api/errors';
import type { PublicBooking } from '@/api/schemas';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { useTenant } from '@/features/tenant/TenantRoot';
import { forgetBooking, listBookings, saveBooking, type VaultEntry } from '@/lib/bookingVault';
import { formatDuration, formatInStudio, formatMoney, formatPhoneHref, formatSlotLong } from '@/lib/format';
import { ReminderPanel } from './ReminderPanel';
import { bookingQueryKey, useBookingByToken } from './useBookingByToken';
import { useBookingRoute } from '@/features/booking/useBookingRoute';
import { useNow } from '@/lib/useNow';

export const STATUS: Record<PublicBooking['status'], { label: string; dot: 'success' | 'warning' | 'error' | 'accent' | 'neutral' }> = {
  confirmed: { label: 'Подтверждена', dot: 'accent' },
  arrived: { label: 'Машина в студии', dot: 'warning' },
  done: { label: 'Готово', dot: 'success' },
  cancelled: { label: 'Отменена', dot: 'neutral' },
  no_show: { label: 'Визит не состоялся', dot: 'error' },
};

/** Imports a shared link (?t=token) into this device and removes the token from the address bar. */
function useTokenImport(slug: string) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('t');
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'importing' | 'failed'>(token ? 'importing' : 'idle');

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    publicApi
      .booking(slug, token)
      .then(({ booking }) => {
        saveBooking(slug, { code: booking.code, token, startsAt: booking.starts_at, serviceName: booking.service_name });
        queryClient.setQueryData(bookingQueryKey(slug, token), booking);
        navigate(`/s/${slug}/my/${booking.code}`, { replace: true });
      })
      .catch(() => setState('failed'));
  }, [token, slug, navigate, queryClient]);
  return state;
}

export function MyBookingsPage() {
  const { slug, data } = useTenant();
  const { open } = useBookingRoute();
  const importState = useTokenImport(slug);
  const now = useNow();
  const [entries, setEntries] = useState<VaultEntry[]>(() => listBookings(slug));
  const queries = useQueries({
    queries: entries.map((e) => ({
      queryKey: bookingQueryKey(slug, e.token),
      queryFn: async () => (await publicApi.booking(slug, e.token)).booking,
    })),
  });

  useEffect(() => {
    const onStorage = () => setEntries(listBookings(slug));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [slug]);

  const rows = useMemo(
    () =>
      entries
        .map((e, i) => ({ entry: e, query: queries[i]! }))
        .sort((a, b) => a.entry.startsAt.localeCompare(b.entry.startsAt)),
    [entries, queries],
  );
  const upcoming = rows.filter((r) => !r.query.data || (['confirmed', 'arrived'].includes(r.query.data.status) && new Date(r.query.data.ends_at).getTime() > now));
  const past = rows.filter((r) => !upcoming.includes(r));

  return (
    <main className="app-page" id="main" tabIndex={-1}>
      <VStack gap={6} paddingBlockStart={6}>
        <Heading level={1}>Моя запись</Heading>
        {importState === 'importing' ? <LoadingRows rows={1} label="Открываем запись по ссылке" /> : null}
        {importState === 'failed' ? (
          <Banner status="error" title="Ссылка на запись не работает" description="Возможно, студия выдала новую ссылку. Уточните у студии." />
        ) : null}

        {entries.length === 0 && importState !== 'importing' ? (
          <EmptyState
            title="На этом устройстве записей нет"
            description="Записи хранятся на устройстве, с которого вы записывались. Если записывались с другого телефона — откройте ссылку на запись или позвоните в студию."
            icon={<CalendarBlank size={40} aria-hidden />}
            actions={<Button label="Записаться" variant="primary" onClick={() => open()} />}
          />
        ) : null}

        {upcoming.length ? (
          <VStack gap={2}>
            <Heading level={2}>Предстоящие</Heading>
            <List hasDividers density="spacious" edgeCompensation="inline">
              {upcoming.map(({ entry, query }) => (
                <BookingRow key={entry.code} entry={entry} booking={query.data} error={query.error} timezone={data.tenant.timezone} slug={slug} />
              ))}
            </List>
          </VStack>
        ) : null}

        {past.length ? (
          <VStack gap={2}>
            <Heading level={2}>Прошедшие и отменённые</Heading>
            <List hasDividers density="balanced" edgeCompensation="inline">
              {past.map(({ entry, query }) => (
                <BookingRow key={entry.code} entry={entry} booking={query.data} error={query.error} timezone={data.tenant.timezone} slug={slug} />
              ))}
            </List>
          </VStack>
        ) : null}
      </VStack>
    </main>
  );
}

function BookingRow({ entry, booking, error, timezone, slug }: { entry: VaultEntry; booking?: PublicBooking; error: unknown; timezone: string; slug: string }) {
  const status = booking ? STATUS[booking.status] : null;
  return (
    <ListItem
      label={booking?.service_name ?? entry.serviceName}
      description={error ? humanError(error) : formatSlotLong(booking?.starts_at ?? entry.startsAt, timezone)}
      href={`/s/${slug}/my/${entry.code}`}
      endContent={
        status ? (
          <HStack gap={1.5} vAlign="center">
            <StatusDot variant={status.dot} label={status.label} />
            <Text type="supporting" color="secondary">
              {status.label}
            </Text>
          </HStack>
        ) : undefined
      }
    />
  );
}

export function BookingDetailPage() {
  const { slug, data } = useTenant();
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const entry = listBookings(slug).find((e) => e.code === code);
  const query = useBookingByToken(slug, entry?.token);
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: () => publicApi.cancel(slug, entry!.token, null),
    onSuccess: (res) => {
      queryClient.setQueryData(bookingQueryKey(slug, entry!.token), res.booking);
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      setConfirmOpen(false);
    },
  });

  if (!entry) {
    return (
      <main className="app-page" id="main" tabIndex={-1}>
        <VStack gap={4} paddingBlockStart={6}>
          <EmptyState
            title="Запись не найдена на этом устройстве"
            description="Откройте ссылку на запись, которую прислала студия, или запишитесь снова."
            actions={<Button label="К моим записям" href={`/s/${slug}/my`} />}
          />
        </VStack>
      </main>
    );
  }

  const b = query.data;
  const tz = data.tenant.timezone;
  const phoneHref = formatPhoneHref(b?.studio.phone ?? data.tenant.phone);

  return (
    <main className="app-page" id="main" tabIndex={-1}>
      <VStack gap={5} paddingBlockStart={6}>
        <Button label="Все мои записи" variant="ghost" size="sm" href={`/s/${slug}/my`} />
        {query.isPending ? <LoadingRows rows={4} label="Загружаем запись" /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {b ? (
          <>
            <VStack gap={2}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <StatusDot variant={STATUS[b.status].dot} label={STATUS[b.status].label} />
                <Text weight="semibold">{STATUS[b.status].label}</Text>
                <Text color="secondary" type="supporting" hasTabularNumbers>
                  Код {b.code}
                </Text>
              </HStack>
              <Heading level={1}>{b.service_name}</Heading>
              <Text type="large">{formatSlotLong(b.starts_at, tz)}</Text>
            </VStack>
            {b.is_demo ? <Banner status="info" title="Это запись в образце студии" description="Студия ещё не запущена — запись тестовая." /> : null}
            <MetadataList columns="single">
              <MetadataListItem label="Длительность">
                {formatDuration(b.duration_minutes)}
                {b.duration_minutes >= 1440 ? ` · выдача ${formatInStudio(b.ends_at, tz, 'd MMMM, HH:mm')}` : ''}
              </MetadataListItem>
              <MetadataListItem label="Бокс">{b.resource_name}</MetadataListItem>
              <MetadataListItem label="Стоимость">{formatMoney(b.price_minor, b.currency, b.price_is_from)}</MetadataListItem>
              <MetadataListItem label="Автомобиль">{[b.car_label, b.car_plate].filter(Boolean).join(', ')}</MetadataListItem>
              <MetadataListItem label="На имя">{b.customer_name}</MetadataListItem>
              {b.studio.address ? <MetadataListItem label="Адрес">{b.studio.address}</MetadataListItem> : null}
            </MetadataList>

            <ReminderPanel booking={b} token={entry.token} slug={slug} />

            <HStack gap={2} wrap="wrap">
              {phoneHref ? <Button label="Позвонить в студию" variant="secondary" icon={<Phone weight="bold" />} href={phoneHref} /> : null}
              {b.studio.map_url ? (
                <Button label="Как добраться" variant="secondary" icon={<MapPin weight="bold" />} href={b.studio.map_url} target="_blank" rel="noopener" />
              ) : null}
            </HStack>

            {b.status === 'confirmed' ? (
              b.can_cancel ? (
                <Button label="Отменить запись" variant="destructive" onClick={() => setConfirmOpen(true)} />
              ) : (
                <Text type="supporting" color="secondary">
                  Онлайн-отмена была доступна до {formatInStudio(b.cancel_deadline, tz, 'd MMMM, HH:mm')}. Чтобы отменить
                  сейчас, позвоните в студию.
                </Text>
              )
            ) : null}
            {cancel.isError ? <Banner status="error" title="Запись не отменена" description={humanError(cancel.error)} /> : null}
            <Button
              label="Убрать с этого устройства"
              variant="ghost"
              size="sm"
              onClick={() => {
                forgetBooking(slug, code);
                navigate(`/s/${slug}/my`, { replace: true });
              }}
            />
            <AlertDialog
              isOpen={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Отменить запись?"
              description={`${b.service_name}, ${formatSlotLong(b.starts_at, tz)}. Время освободится для других клиентов.`}
              actionLabel="Отменить запись"
              actionVariant="destructive"
              cancelLabel="Не отменять"
              isActionLoading={cancel.isPending}
              onAction={() => cancel.mutate()}
            />
          </>
        ) : null}
      </VStack>
    </main>
  );
}
