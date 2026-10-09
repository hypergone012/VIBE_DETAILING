import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { humanError } from '@/api/errors';
import type { OwnerBooking } from '@/api/ownerSchemas';
import { FormDialog } from '@/components/FormDialog';
import { formatMoney, formatSlotLong } from '@/lib/format';
import { ownerKeys, useOwner } from './OwnerContext';
import { fromMinor, PAYMENT_METHODS, toMinor } from './ownerFormat';
import { SlotPicker } from './SlotPicker';

function useRefreshBooking() {
  const { slug } = useOwner();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
    void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
  };
}

/** Money received or returned for this visit. Refunds never exceed what was paid (checked in SQL). */
export function PaymentDialog({
  booking,
  kind,
  onClose,
}: {
  booking: OwnerBooking;
  kind: 'payment' | 'refund';
  onClose: () => void;
}) {
  const { api } = useOwner();
  const refresh = useRefreshBooking();
  const showToast = useToast();
  const net = booking.paid_minor - booking.refunded_minor;
  const suggested = kind === 'payment' ? Math.max(booking.price_minor - net, 0) : net;
  const [amount, setAmount] = useState<number | null>(suggested ? fromMinor(suggested) : null);
  const [method, setMethod] = useState<string>('card');
  const [note, setNote] = useState('');
  const key = useMemo(() => crypto.randomUUID(), []);

  const save = useMutation({
    mutationFn: () => api.addPayment(booking.id, kind, toMinor(amount ?? 0), method, note.trim() || null, key),
    onSuccess: () => {
      refresh();
      showToast({ body: kind === 'payment' ? 'Оплата записана' : 'Возврат записан' });
      onClose();
    },
  });

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={kind === 'payment' ? 'Принять оплату' : 'Вернуть деньги'}
      subtitle={`${booking.service_name} · стоимость ${formatMoney(booking.price_minor, booking.currency, booking.price_is_from)}`}
      actions={
        <>
          <Button label="Отмена" variant="secondary" onClick={onClose} />
          <Button
            label={kind === 'payment' ? 'Записать оплату' : 'Записать возврат'}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!amount || amount <= 0}
            onClick={() => save.mutate()}
          />
        </>
      }
    >
      <VStack gap={4}>
        <NumberInput label="Сумма" units="₽" value={amount} onChange={setAmount} min={0} step={100} isWheelEnabled={false} hasAutoFocus />
        <Selector
          label="Способ"
          value={method}
          onChange={setMethod}
          options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
          width="100%"
        />
        <TextInput label="Комментарий" isOptional value={note} onChange={setNote} />
        {kind === 'refund' ? (
          <Text type="supporting" color="secondary">
            Можно вернуть не больше полученного: {formatMoney(net, booking.currency)}.
          </Text>
        ) : null}
        {save.isError ? <Banner status="error" title="Не записано" description={humanError(save.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}

/** Atomic reschedule: if the new time is taken, the original booking stays as it was. */
export function RescheduleDialog({ booking, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const { api, slug, session } = useOwner();
  const refresh = useRefreshBooking();
  const showToast = useToast();
  const settings = useQuery({ queryKey: ownerKeys.settings(slug), queryFn: () => api.settings() });
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState('keep');
  const service = settings.data?.services.find((s) => s.id === booking.service_id);
  const resources = settings.data?.resources.filter((r) => r.is_active && (service?.resource_ids.includes(r.id) || r.id === booking.resource_id)) ?? [];

  const save = useMutation({
    mutationFn: () => api.reschedule(booking.id, startsAt!, resourceId === 'keep' ? null : resourceId),
    onSuccess: (res) => {
      refresh();
      showToast({ body: res.changed ? `Перенесено на ${formatSlotLong(res.booking.starts_at, session.timezone)}` : 'Время не изменилось' });
      onClose();
    },
  });

  return (
    <FormDialog
      isOpen
      tall
      width={560}
      onOpenChange={(open) => !open && onClose()}
      title="Перенести запись"
      subtitle={`Сейчас: ${formatSlotLong(booking.starts_at, session.timezone)}, ${booking.resource_name}`}
      actions={
        <>
          <Button label="Отмена" variant="secondary" onClick={onClose} />
          <Button label="Перенести" variant="primary" isDisabled={!startsAt} isLoading={save.isPending} onClick={() => save.mutate()} />
        </>
      }
    >
      <VStack gap={4}>
        <SlotPicker serviceId={booking.service_id} value={startsAt} onChange={setStartsAt} />
        {resources.length > 1 ? (
          <Selector
            label="Бокс"
            value={resourceId}
            onChange={setResourceId}
            options={[{ value: 'keep', label: 'Тот же или любой свободный' }, ...resources.map((r) => ({ value: r.id, label: r.name }))]}
            width="100%"
          />
        ) : null}
        <Text type="supporting" color="secondary">
          Время своей же записи показано как занятое — выберите другое. Если новое время успеют занять, запись останется на прежнем.
        </Text>
        {save.isError ? <Banner status="error" title="Не перенесено" description={humanError(save.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}

export function CancelDialog({ booking, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const { api, session } = useOwner();
  const refresh = useRefreshBooking();
  const showToast = useToast();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.cancel(booking.id, reason.trim() || null),
    onSuccess: () => {
      refresh();
      showToast({ body: 'Запись отменена, время освободилось' });
      onClose();
    },
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="Отменить запись?"
      subtitle={`${booking.service_name}, ${formatSlotLong(booking.starts_at, session.timezone)}`}
      actions={
        <>
          <Button label="Не отменять" variant="secondary" onClick={onClose} />
          <Button label="Отменить запись" variant="destructive" isLoading={save.isPending} onClick={() => save.mutate()} />
        </>
      }
    >
      <VStack gap={4}>
        <Text color="secondary">Бокс освободится для других клиентов. Напоминание клиенту не придёт.</Text>
        <TextArea label="Причина" isOptional value={reason} onChange={setReason} rows={2} />
        {save.isError ? <Banner status="error" title="Не отменено" description={humanError(save.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}
