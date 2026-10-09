import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Grid } from '@astryxdesign/core/Grid';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { humanError } from '@/api/errors';
import { FormDialog } from '@/components/FormDialog';
import { ownerKeys, useOwner } from './OwnerContext';
import { asDate, asTime, studioInstant } from './ownerFormat';

/** Close a box for a period (repair, private job). Overlaps with bookings are rejected by the DB. */
export function BlockDialog({
  isOpen,
  onOpenChange,
  resources,
  defaultDate,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  resources: { id: string; name: string; is_active: boolean }[];
  defaultDate: string;
}) {
  const { slug, api, session } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [resourceId, setResourceId] = useState(resources.find((r) => r.is_active)?.id ?? '');
  const [fromDate, setFromDate] = useState(defaultDate);
  const [fromTime, setFromTime] = useState('12:00');
  const [toDate, setToDate] = useState(defaultDate);
  const [toTime, setToTime] = useState('14:00');
  const [note, setNote] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createBlock(
        resourceId,
        studioInstant(fromDate, fromTime, session.timezone),
        studioInstant(toDate, toTime, session.timezone),
        note.trim() || null,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
      showToast({ body: 'Бокс закрыт на это время' });
      onOpenChange(false);
    },
  });

  const invalid = !resourceId || !fromDate || !toDate || !fromTime || !toTime || `${toDate}T${toTime}` <= `${fromDate}T${fromTime}`;

  return (
    <FormDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Закрыть бокс на время"
      subtitle="Клиенты не смогут записаться в этот бокс на выбранный период."
      actions={
        <>
          <Button label="Отмена" variant="secondary" onClick={() => onOpenChange(false)} />
          <Button label="Закрыть бокс" variant="primary" isLoading={create.isPending} isDisabled={invalid} onClick={() => create.mutate()} />
        </>
      }
    >
      <VStack gap={4}>
        <Selector
          label="Бокс"
          value={resourceId}
          onChange={setResourceId}
          options={resources.map((r) => ({ value: r.id, label: r.is_active ? r.name : `${r.name} (выключен)` }))}
          width="100%"
        />
        <Grid columns={2} gap={3}>
          <DateInput label="С даты" value={asDate(fromDate)} onChange={(v) => v && setFromDate(v)} weekStartsOn="mon" format="date" />
          <TimeInput label="Время" value={asTime(fromTime)} onChange={(v) => v && setFromTime(v)} hourFormat="24h" increment={15} />
          <DateInput label="По дату" value={asDate(toDate)} onChange={(v) => v && setToDate(v)} weekStartsOn="mon" format="date" min={asDate(fromDate)} />
          <TimeInput label="Время" value={asTime(toTime)} onChange={(v) => v && setToTime(v)} hourFormat="24h" increment={15} />
        </Grid>
        <TextInput label="Причина" isOptional value={note} onChange={setNote} placeholder="Например: ремонт подъёмника" />
        {create.isError ? <Banner status="error" title="Бокс не закрыт" description={humanError(create.error)} /> : null}
      </VStack>
    </FormDialog>
  );
}
