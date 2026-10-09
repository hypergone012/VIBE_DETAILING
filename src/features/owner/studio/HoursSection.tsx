import { useMemo, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus, Trash } from '@phosphor-icons/react';
import type { HoursRow } from '@/api/ownerSchemas';
import { studioToday, WEEKDAY_NAMES } from '@/lib/format';
import { useOwner } from '../OwnerContext';
import { asDate, asTime, dayTitle } from '../ownerFormat';
import { SaveBar } from './ProfileSection';
import { useSettings, useSettingsMutation } from './useSettings';

type Interval = { opens_at: string; closes_at: string };

/** Weekly hours: when cars are received. A day may have several intervals (e.g. lunch break). */
export function HoursSection() {
  const { api } = useOwner();
  const saved = useSettings().data!.hours;
  const initial = useMemo(
    () => WEEKDAY_NAMES.map((_, i) => saved.filter((h) => h.weekday === i + 1).map(({ opens_at, closes_at }) => ({ opens_at, closes_at }))),
    [saved],
  );
  const [days, setDays] = useState<Interval[][]>(initial);
  const save = useSettingsMutation((rows: HoursRow[]) => api.setHours(rows), 'Часы работы сохранены');
  const changed = days.filter((d, i) => JSON.stringify(d) !== JSON.stringify(initial[i])).length;
  const valid = days.every((d) => d.every((w) => w.opens_at && w.closes_at && w.opens_at < w.closes_at));

  const update = (day: number, fn: (intervals: Interval[]) => Interval[]) => setDays((all) => all.map((d, i) => (i === day ? fn(d) : d)));

  return (
    <VStack gap={6}>
      <List hasDividers density="spacious">
        {WEEKDAY_NAMES.map((name, i) => {
          const intervals = days[i]!;
          const open = intervals.length > 0;
          return (
            <VStack key={name} gap={3} className="hours-row">
              <HStack gap={3} vAlign="center" justify="between">
                <Text weight="semibold">{name}</Text>
                <Switch
                  label="Работаем"
                  labelPosition="start"
                  value={open}
                  onChange={(on) => update(i, () => (on ? [{ opens_at: '09:00', closes_at: '20:00' }] : []))}
                />
              </HStack>
              {intervals.map((w, j) => (
                <HStack key={j} gap={2} vAlign="end" wrap="wrap">
                  <TimeInput
                    label="С"
                    hourFormat="24h"
                    increment={15}
                    value={asTime(w.opens_at)}
                    onChange={(v) => v && update(i, (d) => d.map((x, k) => (k === j ? { ...x, opens_at: v.slice(0, 5) } : x)))}
                    width={120}
                  />
                  <TimeInput
                    label="До"
                    hourFormat="24h"
                    increment={15}
                    value={asTime(w.closes_at)}
                    onChange={(v) => v && update(i, (d) => d.map((x, k) => (k === j ? { ...x, closes_at: v.slice(0, 5) } : x)))}
                    width={120}
                    status={w.opens_at >= w.closes_at ? { type: 'error', message: 'Позже начала' } : undefined}
                  />
                  {intervals.length > 1 ? (
                    <Button label="Убрать интервал" isIconOnly variant="ghost" icon={<Trash />} onClick={() => update(i, (d) => d.filter((_, k) => k !== j))} />
                  ) : null}
                </HStack>
              ))}
              {open && intervals.length < 3 ? (
                <HStack>
                  <Button
                    label="Ещё интервал"
                    size="sm"
                    variant="ghost"
                    icon={<Plus />}
                    onClick={() => update(i, (d) => [...d, { opens_at: d.at(-1)?.closes_at ?? '14:00', closes_at: '20:00' }])}
                  />
                </HStack>
              ) : null}
            </VStack>
          );
        })}
      </List>
      <SaveBar
        count={changed}
        isLoading={save.isPending}
        isDisabled={!valid}
        onSave={() => save.mutate(days.flatMap((d, i) => d.map((w) => ({ weekday: i + 1, ...w }))))}
        onReset={() => setDays(initial)}
      />
    </VStack>
  );
}

/** Days off and special hours; warns when bookings already exist on that date. */
export function ExceptionsSection() {
  const { api, session } = useOwner();
  const exceptions = useSettings().data!.exceptions;
  const today = studioToday(session.timezone);
  const [date, setDate] = useState(today);
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState('10:00');
  const [closes, setCloses] = useState('16:00');
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const add = useSettingsMutation(
    () => api.upsertException({ date, is_closed: closed, opens_at: closed ? null : opens, closes_at: closed ? null : closes, note: note.trim() || null }),
    (r) =>
      r.bookings_on_date > 0
        ? `Сохранено. На этот день уже есть записи: ${r.bookings_on_date} — перенесите или отмените их.`
        : 'Особый день сохранён',
  );
  const remove = useSettingsMutation((d: string) => api.deleteException(d), 'Особый день удалён');

  return (
    <VStack gap={6}>
      <Card padding={5} elevation="low">
        <VStack gap={4}>
          <Text weight="semibold">Добавить день</Text>
          <DateInput label="Дата" value={asDate(date)} onChange={(v) => v && setDate(v)} min={asDate(today)} weekStartsOn="mon" format="date_weekday" />
          <Switch label="Выходной" description="Иначе — особые часы приёма" value={closed} onChange={setClosed} />
          {closed ? null : (
            <Grid columns={2} gap={3}>
              <TimeInput label="С" hourFormat="24h" increment={15} value={asTime(opens)} onChange={(v) => v && setOpens(v.slice(0, 5))} />
              <TimeInput label="До" hourFormat="24h" increment={15} value={asTime(closes)} onChange={(v) => v && setCloses(v.slice(0, 5))} />
            </Grid>
          )}
          <TextInput label="Пояснение" isOptional value={note} onChange={setNote} placeholder="Например: праздник" />
          <HStack>
            <Button
              label="Сохранить день"
              variant="primary"
              isDisabled={!date || (!closed && opens >= closes)}
              isLoading={add.isPending}
              onClick={() => add.mutate(undefined, { onSuccess: () => setNote('') })}
            />
          </HStack>
        </VStack>
      </Card>
      <VStack gap={2}>
        <Text weight="semibold">Ближайшие особые дни</Text>
        {exceptions.length === 0 ? <Text color="secondary">Нет — студия работает по обычному графику.</Text> : null}
        <List hasDividers density="balanced">
          {exceptions.map((e) => (
            <ListItem
              key={e.id}
              label={dayTitle(e.date)}
              description={`${e.is_closed ? 'выходной' : `${e.opens_at}–${e.closes_at}`}${e.note ? ` · ${e.note}` : ''}`}
              endContent={<Button label="Удалить" size="sm" variant="ghost" onClick={() => setRemoving(e.date)} />}
            />
          ))}
        </List>
      </VStack>
      <Divider />
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Удалить особый день?"
        description="В этот день снова будет действовать обычный график."
        actionLabel="Удалить"
        cancelLabel="Оставить"
        isActionLoading={remove.isPending}
        onAction={() => removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
    </VStack>
  );
}
