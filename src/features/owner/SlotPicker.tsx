import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { studioToday } from '@/lib/format';
import { ownerKeys, useOwner } from './OwnerContext';
import { addDays, dayTitle } from './ownerFormat';

/**
 * Free start times for a service from the real schedule (owner_slots: boxes,
 * duration + preparation, hours, exceptions; the client lead time is ignored).
 */
export function SlotPicker({
  serviceId,
  value,
  onChange,
}: {
  serviceId: string;
  value: string | null;
  onChange: (startsAt: string) => void;
}) {
  const { slug, api, session } = useOwner();
  const today = studioToday(session.timezone);
  const [from, setFrom] = useState(today);
  // Until a day is picked, show the first day of the week with a free start time.
  const [picked, setPicked] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ownerKeys.slots(slug, serviceId, from),
    queryFn: () => api.slots(serviceId, from, 7),
  });
  const firstFree = query.data?.days.find((d) => d.slots.some((x) => x.available))?.date;
  const date = picked ?? firstFree ?? from;
  const day = useMemo(() => query.data?.days.find((d) => d.date === date), [query.data, date]);

  const shift = (days: number) => {
    setFrom(addDays(from, days));
    setPicked(null);
  };

  return (
    <VStack gap={3}>
      <HStack gap={1} vAlign="center" justify="between">
        <Button label="Раньше" variant="ghost" isIconOnly icon={<CaretLeft weight="bold" />} isDisabled={from <= addDays(today, -1)} onClick={() => shift(-7)} />
        <Text weight="semibold">
          {dayTitle(from, 'd MMM')} – {dayTitle(addDays(from, 6), 'd MMM')}
        </Text>
        <Button label="Позже" variant="ghost" isIconOnly icon={<CaretRight weight="bold" />} onClick={() => shift(7)} />
      </HStack>
      {query.isPending ? <LoadingRows rows={2} label="Ищем свободное время" /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <>
          <HStack gap={2} className="day-strip" role="group" aria-label="Дата">
            {query.data.days.map((d) => {
              const free = d.slots.filter((s) => s.available).length;
              return (
                <button
                  key={d.date}
                  type="button"
                  className="day-chip"
                  aria-pressed={d.date === date}
                  data-closed={free === 0}
                  aria-label={`${dayTitle(d.date)}: ${d.slots.length === 0 ? 'нет приёма' : free ? `свободно ${free}` : 'всё занято'}`}
                  onClick={() => setPicked(d.date)}
                >
                  <Text type="supporting" color="inherit">
                    {dayTitle(d.date, 'EEEEEE')}
                  </Text>
                  <Text weight="semibold" color="inherit" hasTabularNumbers>
                    {dayTitle(d.date, 'd')}
                  </Text>
                  <Text type="supporting" color={free ? 'accent' : 'inherit'}>
                    {d.slots.length === 0 ? '—' : free || 'нет'}
                  </Text>
                </button>
              );
            })}
          </HStack>
          {day && day.slots.length ? (
            <Grid columns={{ minWidth: 76, repeat: 'fill' }} gap={2} role="group" aria-label="Время">
              {day.slots.map((s) => (
                <button
                  key={s.starts_at}
                  type="button"
                  className="slot"
                  disabled={!s.available}
                  aria-pressed={value === s.starts_at}
                  aria-label={s.available ? `${s.time}, свободно боксов: ${s.free_resources}` : `${s.time}, занято`}
                  onClick={() => onChange(s.starts_at)}
                >
                  {s.time}
                </button>
              ))}
            </Grid>
          ) : (
            <Text color="secondary">В этот день нет приёма на эту услугу.</Text>
          )}
        </>
      ) : null}
    </VStack>
  );
}
