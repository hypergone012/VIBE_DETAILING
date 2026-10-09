import { useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { useClipboard } from '@astryxdesign/core/hooks';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { ArrowLeft, ArrowsClockwise, CheckCircle, Copy, LinkSimple, Phone, ShareNetwork, XCircle } from '@phosphor-icons/react';
import { humanError } from '@/api/errors';
import type { BookingStatus, OwnerBooking } from '@/api/ownerSchemas';
import { PageFrame, useIsWide } from '@/components/PageFrame';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { formatDuration, formatInStudio, formatMoney, formatPhoneHref } from '@/lib/format';
import { CancelDialog, PaymentDialog, RescheduleDialog } from './BookingDialogs';
import { ownerKeys, useOwner } from './OwnerContext';
import { balanceOf, describeEvent, methodLabel, OWNER_STATUS, timeRange } from './ownerFormat';

type DialogState = null | 'reschedule' | 'cancel' | 'payment' | 'refund' | 'no_show';

export function BookingPage() {
  const { id = '' } = useParams();
  const { slug, api, base, session } = useOwner();
  const wide = useIsWide();
  const location = useLocation();
  const created = (location.state as { accessToken?: string; created?: boolean } | null) ?? null;
  const query = useQuery({ queryKey: ownerKeys.booking(slug, id), queryFn: () => api.booking(id) });
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <PageFrame width={960}>
      <VStack gap={6} paddingBlockStart={4}>
        <HStack>
          <Button label="К записям" variant="ghost" size="sm" icon={<ArrowLeft weight="bold" />} href={`${base}/`} />
        </HStack>
        {query.isPending ? <LoadingRows rows={5} label="Загружаем запись" /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Запись не открылась" /> : null}
        {query.data ? (
          <>
            <Header booking={query.data.booking} />
            {created?.created ? (
              <Banner status="success" title="Клиент записан" description="Отправьте клиенту ссылку на запись — по ней он увидит время и сможет отменить." />
            ) : null}
            <StatusActions booking={query.data.booking} onDialog={setDialog} />
            <Grid columns={wide ? 2 : 1} gap={8} align="start">
              <VStack gap={8} className="grid-cell">
                <ClientSection booking={query.data.booking} />
                <NoteSection key={query.data.booking.owner_note ?? ''} booking={query.data.booking} />
                <ClientLinkSection booking={query.data.booking} initialToken={created?.accessToken ?? null} />
              </VStack>
              <VStack gap={8} className="grid-cell">
                <MoneySection booking={query.data.booking} payments={query.data.payments} onDialog={setDialog} />
                <VStack gap={3}>
                  <Heading level={2}>История</Heading>
                  <List density="compact" hasDividers>
                    {query.data.events.map((e, i) => (
                      <ListItem
                        key={`${e.created_at}-${i}`}
                        label={describeEvent(e, session.timezone, session.currency)}
                        description={formatInStudio(e.created_at, session.timezone, 'd MMMM, HH:mm')}
                      />
                    ))}
                  </List>
                </VStack>
              </VStack>
            </Grid>
          </>
        ) : null}
      </VStack>
      {query.data && dialog === 'reschedule' ? <RescheduleDialog booking={query.data.booking} onClose={() => setDialog(null)} /> : null}
      {query.data && dialog === 'cancel' ? <CancelDialog booking={query.data.booking} onClose={() => setDialog(null)} /> : null}
      {query.data && (dialog === 'payment' || dialog === 'refund') ? (
        <PaymentDialog booking={query.data.booking} kind={dialog} onClose={() => setDialog(null)} />
      ) : null}
      {query.data && dialog === 'no_show' ? <NoShowDialog booking={query.data.booking} onClose={() => setDialog(null)} /> : null}
    </PageFrame>
  );
}

function Header({ booking: b }: { booking: OwnerBooking }) {
  const { session } = useOwner();
  const status = OWNER_STATUS[b.status];
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StatusDot variant={status.dot} label={status.label} />
        <Text weight="semibold">{status.label}</Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          Код {b.code}
        </Text>
        <Token label={b.source === 'owner' ? 'по звонку' : 'онлайн'} size="sm" />
        {b.is_demo ? <Token label="демо" size="sm" color="yellow" /> : null}
      </HStack>
      <Heading level={1} type="display-3" textWrap="balance">
        {b.service_name}
      </Heading>
      <Text type="large" hasTabularNumbers>
        {formatInStudio(b.starts_at, session.timezone, 'EEEE, d MMMM')} · {timeRange(b.starts_at, b.ends_at, session.timezone)}
      </Text>
      <Text color="secondary">
        {b.resource_name} · {formatDuration(b.duration_minutes)}
        {b.buffer_minutes ? ` + ${formatDuration(b.buffer_minutes)} подготовка бокса` : ''}
        {b.reschedule_count ? ` · переносов: ${b.reschedule_count}` : ''}
      </Text>
      {b.status === 'cancelled' && b.cancel_reason ? <Text color="secondary">Причина отмены: {b.cancel_reason}</Text> : null}
    </VStack>
  );
}

function StatusActions({ booking: b, onDialog }: { booking: OwnerBooking; onDialog: (d: DialogState) => void }) {
  const { api, slug } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const setStatus = useMutation({
    mutationFn: (status: BookingStatus) => api.setStatus(b.id, status),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
      showToast({ body: `Статус: ${OWNER_STATUS[res.booking.status].label}` });
    },
    onError: (e) => showToast({ body: humanError(e) }),
  });
  const pending = (s: BookingStatus) => setStatus.isPending && setStatus.variables === s;

  if (b.status === 'cancelled' || b.status === 'no_show') return null;
  return (
    <HStack gap={2} wrap="wrap">
      {b.status === 'confirmed' ? (
        <>
          <Button label="Машина приехала" variant="primary" icon={<CheckCircle weight="bold" />} isLoading={pending('arrived')} onClick={() => setStatus.mutate('arrived')} />
          <Button label="Не приехал" variant="secondary" onClick={() => onDialog('no_show')} />
        </>
      ) : null}
      {b.status === 'arrived' ? (
        <>
          <Button label="Работа готова" variant="primary" icon={<CheckCircle weight="bold" />} isLoading={pending('done')} onClick={() => setStatus.mutate('done')} />
          <Button label="Ещё не приехал" variant="ghost" isLoading={pending('confirmed')} onClick={() => setStatus.mutate('confirmed')} />
        </>
      ) : null}
      {b.status === 'done' ? (
        <Button label="Вернуть в работу" variant="secondary" isLoading={pending('arrived')} onClick={() => setStatus.mutate('arrived')} />
      ) : null}
      {b.status === 'confirmed' || b.status === 'arrived' ? (
        <>
          <Button label="Перенести" variant="secondary" icon={<ArrowsClockwise weight="bold" />} onClick={() => onDialog('reschedule')} />
          <Button label="Отменить" variant="ghost" icon={<XCircle weight="bold" />} onClick={() => onDialog('cancel')} />
        </>
      ) : null}
    </HStack>
  );
}

function NoShowDialog({ booking, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const { api, slug } = useOwner();
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: () => api.setStatus(booking.id, 'no_show'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
      onClose();
    },
  });
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="Клиент не приехал?"
      description="Бокс освободится на это время. Отметку нельзя отменить."
      actionLabel="Отметить"
      cancelLabel="Назад"
      isActionLoading={mark.isPending}
      onAction={() => mark.mutate()}
    />
  );
}

function ClientSection({ booking: b }: { booking: OwnerBooking }) {
  const phoneHref = formatPhoneHref(b.customer_phone);
  return (
    <VStack gap={3}>
      <Heading level={2}>Клиент</Heading>
      <MetadataList>
        <MetadataListItem label="Имя">{b.customer_name}</MetadataListItem>
        <MetadataListItem label="Телефон">
          {phoneHref ? <Link href={phoneHref}>{b.customer_phone}</Link> : b.customer_phone}
        </MetadataListItem>
        <MetadataListItem label="Машина">{b.car_label}</MetadataListItem>
        {b.car_plate ? <MetadataListItem label="Госномер">{b.car_plate}</MetadataListItem> : null}
        {b.customer_comment ? <MetadataListItem label="Пожелания">{b.customer_comment}</MetadataListItem> : null}
      </MetadataList>
      {phoneHref ? (
        <HStack>
          <Button label="Позвонить" variant="secondary" icon={<Phone weight="bold" />} href={phoneHref} />
        </HStack>
      ) : null}
    </VStack>
  );
}

function MoneySection({
  booking: b,
  payments,
  onDialog,
}: {
  booking: OwnerBooking;
  payments: { id: string; kind: 'payment' | 'refund'; amount_minor: number; method: string; paid_at: string; note: string | null }[];
  onDialog: (d: DialogState) => void;
}) {
  const { session } = useOwner();
  const net = b.paid_minor - b.refunded_minor;
  const balance = balanceOf(b);
  return (
    <VStack gap={3}>
      <Heading level={2}>Оплата</Heading>
      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <MetadataList>
            <MetadataListItem label={b.price_is_from ? 'Стоимость (от)' : 'Стоимость'}>
              {formatMoney(b.price_minor, b.currency)}
            </MetadataListItem>
            <MetadataListItem label="Получено">{formatMoney(net, b.currency)}</MetadataListItem>
            {b.refunded_minor ? <MetadataListItem label="Из них возвращено">{formatMoney(b.refunded_minor, b.currency)}</MetadataListItem> : null}
            <MetadataListItem label="Осталось получить">
              <Text weight="semibold" hasTabularNumbers color={balance > 0 ? 'primary' : 'secondary'}>
                {formatMoney(Math.max(balance, 0), b.currency)}
              </Text>
            </MetadataListItem>
          </MetadataList>
          <Text type="supporting" color="secondary">
            Цена зафиксирована на момент записи и не меняется, если прайс обновится.
          </Text>
          {b.status !== 'cancelled' || net > 0 ? (
            <HStack gap={2} wrap="wrap">
              {b.status !== 'cancelled' ? <Button label="Принять оплату" variant="primary" onClick={() => onDialog('payment')} /> : null}
              {net > 0 ? <Button label="Вернуть деньги" variant="secondary" onClick={() => onDialog('refund')} /> : null}
            </HStack>
          ) : null}
          {payments.length ? (
            <>
              <Divider />
              <List density="compact">
                {payments.map((p) => (
                  <ListItem
                    key={p.id}
                    label={`${p.kind === 'payment' ? 'Оплата' : 'Возврат'} · ${methodLabel(p.method)}`}
                    description={`${formatInStudio(p.paid_at, session.timezone, 'd MMMM, HH:mm')}${p.note ? ` · ${p.note}` : ''}`}
                    endContent={
                      <Text weight="semibold" hasTabularNumbers color={p.kind === 'refund' ? 'secondary' : 'primary'}>
                        {p.kind === 'refund' ? '−' : '+'}
                        {formatMoney(p.amount_minor, b.currency)}
                      </Text>
                    }
                  />
                ))}
              </List>
            </>
          ) : null}
        </VStack>
      </Card>
    </VStack>
  );
}

function NoteSection({ booking: b }: { booking: OwnerBooking }) {
  const { api, slug } = useOwner();
  const queryClient = useQueryClient();
  const [note, setNote] = useState(b.owner_note ?? '');
  const save = useMutation({
    mutationFn: () => api.updateNote(b.id, note),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ownerKeys.booking(slug, b.id) }),
  });
  const changed = note !== (b.owner_note ?? '');
  return (
    <VStack gap={3}>
      <Heading level={2}>Заметка студии</Heading>
      <TextArea label="Заметка" isLabelHidden description="Видна только в кабинете" value={note} onChange={setNote} rows={3} maxLength={500} />
      <HStack gap={2} vAlign="center">
        <Button label="Сохранить заметку" variant="secondary" size="sm" isDisabled={!changed} isLoading={save.isPending} onClick={() => save.mutate()} />
        {save.isSuccess && !changed ? (
          <Text type="supporting" color="secondary" role="status">
            Сохранено
          </Text>
        ) : null}
        {save.isError ? (
          <Text type="supporting" color="secondary" role="alert">
            {humanError(save.error)}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** One-time client link (the token is stored only as a hash; a new link replaces the old one). */
function ClientLinkSection({ booking: b, initialToken }: { booking: OwnerBooking; initialToken: string | null }) {
  const { api, slug } = useOwner();
  const [token, setToken] = useState(initialToken);
  const { copy, isCopied } = useClipboard({ announce: 'Ссылка скопирована' });
  const issue = useMutation({ mutationFn: () => api.issueLink(b.id), onSuccess: (res) => setToken(res.access_token) });
  const url = token ? `${window.location.origin}/s/${slug}/my?t=${encodeURIComponent(token)}` : null;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  if (b.status === 'cancelled') return null;
  return (
    <VStack gap={3}>
      <Heading level={2}>Ссылка для клиента</Heading>
      {url ? (
        <VStack gap={2}>
          <TextInput label="Ссылка на запись" isLabelHidden value={url} isReadOnly onChange={() => undefined} />
          <HStack gap={2} wrap="wrap">
            <Button label={isCopied ? 'Скопировано' : 'Скопировать'} variant="primary" icon={<Copy weight="bold" />} onClick={() => void copy(url)} />
            {canShare ? (
              <Button
                label="Отправить"
                variant="secondary"
                icon={<ShareNetwork weight="bold" />}
                onClick={() => void navigator.share({ title: 'Ваша запись', url }).catch(() => undefined)}
              />
            ) : null}
          </HStack>
          <Text type="supporting" color="secondary">
            Ссылка показывается один раз. Если выдать новую, старая перестанет работать.
          </Text>
        </VStack>
      ) : (
        <VStack gap={2}>
          <Text color="secondary">Клиент откроет запись по ссылке: время, адрес, отмена и напоминание.</Text>
          <HStack>
            <Button label="Выдать ссылку" variant="secondary" icon={<LinkSimple weight="bold" />} isLoading={issue.isPending} onClick={() => issue.mutate()} />
          </HStack>
          {issue.isError ? <Banner status="error" title="Ссылка не выдана" description={humanError(issue.error)} /> : null}
        </VStack>
      )}
    </VStack>
  );
}
