import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { CaretLeft, CaretRight, LockSimple, Plus } from '@phosphor-icons/react';
import type { Block, OwnerBooking, Schedule } from '@/api/ownerSchemas';
import { humanError } from '@/api/errors';
import { PageFrame, useIsWide } from '@/components/PageFrame';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { SectionHeader } from '@/components/SectionHeader';
import { formatInStudio, studioToday } from '@/lib/format';
import { BlockDialog } from './BlockDialog';
import { ownerKeys, useOwner } from './OwnerContext';
import { addDays, dayTitle, mondayOf, OWNER_STATUS, timeRange } from './ownerFormat';

type View = 'day' | 'week';

/** Bookings and blocks for a day or a week, in the studio timezone. */
export function SchedulePage() {
  const { slug, api, session, base } = useOwner();
  const wide = useIsWide();
  const tz = session.timezone;
  const today = studioToday(tz);
  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState(today);
  const [blockOpen, setBlockOpen] = useState(false);
  const from = view === 'day' ? anchor : mondayOf(anchor);
  const to = view === 'day' ? anchor : addDays(from, 6);

  const query = useQuery({
    queryKey: ownerKeys.schedule(slug, from, to),
    queryFn: () => api.schedule('custom', from, to),
    refetchInterval: 60_000,
  });

  const step = view === 'day' ? 1 : 7;
  const title =
    view === 'day'
      ? `${anchor === today ? 'Сегодня, ' : anchor === addDays(today, 1) ? 'Завтра, ' : ''}${dayTitle(anchor, anchor === today || anchor === addDays(today, 1) ? 'd MMMM' : 'EEEE, d MMMM')}`
      : `${dayTitle(from, 'd MMM')} – ${dayTitle(to, 'd MMM')}`;

  return (
    <PageFrame width={960}>
      <VStack gap={6} paddingBlockStart={4}>
        <SectionHeader
          level={1}
          size="page"
          eyebrow={session.name}
          title="Записи"
          action={wide ? undefined : <Button label="Новая" variant="primary" icon={<Plus weight="bold" />} href={`${base}/new`} />}
        />

        <VStack gap={3}>
          <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
            <SegmentedControl label="Период" value={view} onChange={(v) => setView(v as View)}>
              <SegmentedControlItem value="day" label="День" />
              <SegmentedControlItem value="week" label="Неделя" />
            </SegmentedControl>
            <HStack gap={1} vAlign="center">
              <Button label="Назад" variant="ghost" isIconOnly icon={<CaretLeft weight="bold" />} onClick={() => setAnchor(addDays(anchor, -step))} />
              <Button label="Сегодня" variant="secondary" size="sm" isDisabled={from <= today && today <= to} onClick={() => setAnchor(today)} />
              <Button label="Вперёд" variant="ghost" isIconOnly icon={<CaretRight weight="bold" />} onClick={() => setAnchor(addDays(anchor, step))} />
            </HStack>
          </HStack>
          <Heading level={2} aria-live="polite">
            {title}
          </Heading>
        </VStack>

        {query.isPending ? <LoadingRows rows={4} label="Загружаем записи" /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Не удалось загрузить записи" /> : null}
        {query.data ? (
          <>
            <Summary data={query.data} />
            {view === 'day' ? (
              <DayList data={query.data} date={anchor} onBlock={() => setBlockOpen(true)} />
            ) : (
              <VStack gap={6}>
                {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => (
                  <VStack key={d} gap={2}>
                    <HStack gap={2} vAlign="center">
                      <Text weight="semibold">{dayTitle(d)}</Text>
                      {d === today ? <Token label="сегодня" size="sm" /> : null}
                    </HStack>
                    <DayList data={query.data} date={d} compact />
                  </VStack>
                ))}
              </VStack>
            )}
            <HStack gap={2} wrap="wrap">
              <Button label="Закрыть бокс на время" variant="secondary" icon={<LockSimple weight="bold" />} onClick={() => setBlockOpen(true)} />
            </HStack>
          </>
        ) : null}
      </VStack>
      {blockOpen && query.data ? (
        <BlockDialog isOpen={blockOpen} onOpenChange={setBlockOpen} resources={query.data.resources} defaultDate={anchor < today ? today : anchor} />
      ) : null}
    </PageFrame>
  );
}

function Summary({ data }: { data: Schedule }) {
  const active = data.bookings.filter((b) => b.status !== 'cancelled');
  const inWork = active.filter((b) => b.status === 'arrived').length;
  const waiting = active.filter((b) => b.status === 'confirmed').length;
  const done = active.filter((b) => b.status === 'done').length;
  return (
    <HStack gap={2} wrap="wrap">
      <Token label={`Записей: ${active.length}`} />
      {waiting ? <Token label={`Ждём: ${waiting}`} /> : null}
      {inWork ? <Token label={`В работе: ${inWork}`} color="orange" /> : null}
      {done ? <Token label={`Готово: ${done}`} color="green" /> : null}
      {data.blocks.length ? <Token label={`Блокировок: ${data.blocks.length}`} /> : null}
    </HStack>
  );
}

type Row = { kind: 'booking'; at: string; booking: OwnerBooking } | { kind: 'block'; at: string; block: Block };

/** Items touching one studio day: bookings (incl. multi-day jobs) and blocks, by start time. */
function DayList({ data, date, compact = false, onBlock }: { data: Schedule; date: string; compact?: boolean; onBlock?: () => void }) {
  const { base, session, api, slug } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const tz = session.timezone;
  const resourceName = useMemo(() => new Map(data.resources.map((r) => [r.id, r.name])), [data.resources]);
  const release = useMutation({
    mutationFn: (id: string) => api.releaseBlock(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all(slug) });
      showToast({ body: 'Бокс снова открыт для записи' });
    },
    onError: (e) => showToast({ body: humanError(e) }),
  });

  const touches = (start: string, end: string) =>
    formatInStudio(start, tz, 'yyyy-MM-dd') <= date && formatInStudio(end, tz, 'yyyy-MM-dd') >= date;
  const rows: Row[] = [
    ...data.bookings.filter((b) => touches(b.starts_at, b.ends_at)).map((b) => ({ kind: 'booking' as const, at: b.starts_at, booking: b })),
    ...data.blocks.filter((b) => touches(b.starts_at, b.ends_at)).map((b) => ({ kind: 'block' as const, at: b.starts_at, block: b })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (rows.length === 0) {
    return compact ? (
      <Text type="supporting" color="secondary">
        Записей нет
      </Text>
    ) : (
      <EmptyState
        title="На этот день записей нет"
        description="Добавьте запись по звонку или закройте бокс, если он занят."
        actions={
          <HStack gap={2} wrap="wrap" justify="center">
            <Button label="Новая запись" variant="primary" href={`${base}/new`} />
            {onBlock ? <Button label="Закрыть бокс" variant="secondary" onClick={onBlock} /> : null}
          </HStack>
        }
      />
    );
  }

  return (
    <List hasDividers density={compact ? 'balanced' : 'spacious'} edgeCompensation="inline">
      {rows.map((row) =>
        row.kind === 'booking' ? (
          <ListItem
            key={row.booking.id}
            href={`${base}/booking/${row.booking.id}`}
            startContent={
              <VStack gap={0.5} className="schedule-time">
                <Text weight="semibold" hasTabularNumbers color={row.booking.status === 'cancelled' ? 'secondary' : 'primary'}>
                  {formatInStudio(row.booking.starts_at, tz, 'yyyy-MM-dd') === date ? formatInStudio(row.booking.starts_at, tz, 'HH:mm') : 'с ' + formatInStudio(row.booking.starts_at, tz, 'd.MM')}
                </Text>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {formatInStudio(row.booking.ends_at, tz, 'yyyy-MM-dd') === date ? formatInStudio(row.booking.ends_at, tz, 'HH:mm') : 'до ' + formatInStudio(row.booking.ends_at, tz, 'd.MM')}
                </Text>
              </VStack>
            }
            label={`${row.booking.service_name}${row.booking.status === 'cancelled' ? ' — отменена' : ''}`}
            description={`${row.booking.customer_name} · ${row.booking.car_label}${row.booking.car_plate ? `, ${row.booking.car_plate}` : ''} · ${row.booking.resource_name}`}
            endContent={
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant={OWNER_STATUS[row.booking.status].dot} label={OWNER_STATUS[row.booking.status].label} />
                {compact ? null : (
                  <Text type="supporting" color="secondary">
                    {OWNER_STATUS[row.booking.status].label}
                  </Text>
                )}
              </HStack>
            }
          />
        ) : (
          <ListItem
            key={row.block.id}
            startContent={
              <VStack gap={0.5} className="schedule-time">
                <LockSimple size={18} aria-hidden className="icon-secondary" />
              </VStack>
            }
            label={`${resourceName.get(row.block.resource_id) ?? 'Бокс'} закрыт`}
            description={`${timeRange(row.block.starts_at, row.block.ends_at, tz)}${row.block.note ? ` · ${row.block.note}` : ''}`}
            endContent={
              <Button
                label="Открыть"
                size="sm"
                variant="ghost"
                isLoading={release.isPending && release.variables === row.block.id}
                onClick={() => release.mutate(row.block.id)}
              />
            }
          />
        ),
      )}
    </List>
  );
}
