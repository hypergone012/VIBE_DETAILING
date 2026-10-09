import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { PeriodKey } from '@/api/ownerApi';
import type { Stats } from '@/api/ownerSchemas';
import { PageFrame } from '@/components/PageFrame';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { SectionHeader } from '@/components/SectionHeader';
import { formatMoney, utcOffsetLabel } from '@/lib/format';
import { ownerKeys, useOwner } from './OwnerContext';
import { dayTitle } from './ownerFormat';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'this_week', label: 'Неделя' },
  { key: 'this_month', label: 'Месяц' },
  { key: 'last_30_days', label: '30 дней' },
];

/**
 * Figures computed in SQL for a period resolved in the studio timezone — the same
 * period keys the owner assistant uses. Visits, completed jobs and money received
 * are separate facts; the value of upcoming bookings is shown apart and is not revenue.
 */
export function StatsPage() {
  const { slug, api, session } = useOwner();
  const [period, setPeriod] = useState<PeriodKey>('this_week');
  const query = useQuery({ queryKey: ownerKeys.stats(slug, period), queryFn: () => api.stats(period) });

  return (
    <PageFrame width={960}>
      <VStack gap={6} paddingBlockStart={4}>
        <SectionHeader level={1} size="page" eyebrow={session.name} title="Машины и деньги" />
        <SegmentedControl label="Период" value={period} onChange={(v) => setPeriod(v as PeriodKey)} layout="fill">
          {PERIODS.map((p) => (
            <SegmentedControlItem key={p.key} value={p.key} label={p.label} />
          ))}
        </SegmentedControl>
        {query.isPending ? <LoadingRows rows={4} label="Считаем" /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Статистика не загрузилась" /> : null}
        {query.data ? <StatsBody stats={query.data} /> : null}
      </VStack>
    </PageFrame>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card padding={5}>
      <VStack gap={2}>
        <Text type="supporting" color="secondary" className="eyebrow">
          {label}
        </Text>
        <Heading level={2} type="display-3">
          {value}
        </Heading>
        <Text type="supporting" color="secondary" textWrap="pretty">
          {note}
        </Text>
      </VStack>
    </Card>
  );
}

function StatsBody({ stats: s }: { stats: Stats }) {
  const money = (minor: number) => formatMoney(minor, s.currency);
  const range = s.period.from === s.period.to ? dayTitle(s.period.from, 'd MMMM') : `${dayTitle(s.period.from, 'd MMM')} – ${dayTitle(s.period.to, 'd MMM')}`;

  return (
    <VStack gap={8}>
      <Text color="secondary">
        {range} · время студии ({utcOffsetLabel(s.period.timezone)})
      </Text>
      <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4}>
        <Metric label="Заезды" value={String(s.visits)} note="Машин приехало в студию" />
        <Metric label="Выполнено" value={String(s.completed)} note="Заказов отмечено «Готово»" />
        <Metric
          label="Получено денег"
          value={money(s.net_received_minor)}
          note={s.refunded_minor ? `Оплаты ${money(s.received_minor)}, возвраты ${money(s.refunded_minor)}` : `Оплат: ${s.payments_count}`}
        />
      </Grid>

      <Card padding={5} variant="muted">
        <VStack gap={2}>
          <Text weight="semibold">Запланировано на период</Text>
          <Text hasTabularNumbers>
            {s.scheduled_count} {s.scheduled_count === 1 ? 'запись' : 'записей'} на сумму {money(s.scheduled_value_minor)} по прайсу
          </Text>
          <Text type="supporting" color="secondary" textWrap="pretty">
            Это ожидаемая стоимость будущих и текущих визитов, а не выручка: деньги появятся в «Получено», когда вы отметите оплату.
          </Text>
        </VStack>
      </Card>

      <HStack gap={6} wrap="wrap">
        <Text color="secondary">
          Новых записей: <Text weight="semibold" color="primary">{s.new_bookings}</Text>
        </Text>
        <Text color="secondary">
          Отмен: <Text weight="semibold" color="primary">{s.cancellations}</Text>
        </Text>
        <Text color="secondary">
          Не приехали: <Text weight="semibold" color="primary">{s.no_shows}</Text>
        </Text>
      </HStack>

      {s.by_day && s.by_day.length > 1 ? (
        <VStack gap={3}>
          <Divider />
          <Heading level={2}>По дням</Heading>
          <Table
            density="compact"
            idKey="date"
            data={s.by_day.map((d) => ({ ...d }))}
            columns={[
              { key: 'date', header: 'День', renderCell: (d) => dayTitle(String(d.date), 'EEEEEE, d MMM') },
              { key: 'visits', header: 'Заезды', align: 'end' },
              { key: 'completed', header: 'Готово', align: 'end' },
              { key: 'net_received_minor', header: 'Получено', align: 'end', renderCell: (d) => money(Number(d.net_received_minor)) },
            ]}
          />
        </VStack>
      ) : null}
    </VStack>
  );
}
