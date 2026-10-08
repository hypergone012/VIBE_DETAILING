import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { publicApi } from '@/api/publicApi';
import type { Service } from '@/api/schemas';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { formatDuration, formatInStudio, formatMoney, timezonesDiffer, utcOffsetLabel } from '@/lib/format';

export const slotsQueryKey = (slug: string, serviceId: string) => ['slots', slug, serviceId] as const;
const DAYS = 14;

export function TimeStep({
  slug,
  service,
  timezone,
  currency,
  date,
  start,
  onPickDate,
  onPickStart,
  onChangeService,
}: {
  slug: string;
  service: Service;
  timezone: string;
  currency: string;
  date: string | null;
  start: string | null;
  onPickDate: (date: string) => void;
  onPickStart: (iso: string) => void;
  onChangeService: () => void;
}) {
  const query = useQuery({
    queryKey: slotsQueryKey(slug, service.id),
    queryFn: () => publicApi.slots(slug, service.id, null, DAYS),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const days = useMemo(
    () =>
      (query.data?.days ?? []).map((d) => ({
        date: d.date,
        total: d.slots.length,
        free: d.slots.filter((s) => s.available).length,
        slots: d.slots,
      })),
    [query.data],
  );
  const firstFree = days.find((d) => d.free > 0);
  const selected = days.find((d) => d.date === date) ?? firstFree ?? days[0];
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  // Default to the first day with free time; keep it in the URL so Back works.
  useEffect(() => {
    if (!date && firstFree) onPickDate(firstFree.date);
  }, [date, firstFree, onPickDate]);

  useEffect(() => {
    if (selected) chipRefs.current.get(selected.date)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [selected]);

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" justify="between">
        <VStack gap={0.5}>
          <Text weight="semibold">{service.name}</Text>
          <Text color="secondary" type="supporting">
            {formatDuration(service.duration_minutes)} · {formatMoney(service.price_minor, currency, service.price_is_from)}
          </Text>
        </VStack>
        <Button label="Изменить" variant="ghost" size="sm" onClick={onChangeService} />
      </HStack>

      {service.duration_minutes >= 1440 ? (
        <Banner
          status="info"
          title={`Машина остаётся в боксе ${formatDuration(service.duration_minutes)}`}
          description="Выберите время приёма: бокс будет занят за вами всё это время, выдача — в рабочие часы."
        />
      ) : null}

      {timezonesDiffer(timezone) ? (
        <Text type="supporting" color="secondary">
          Время указано по часовому поясу студии ({utcOffsetLabel(timezone)}).
        </Text>
      ) : null}

      {query.isPending ? <LoadingRows rows={3} label="Ищем свободное время" /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Не удалось получить свободное время" /> : null}

      {query.data ? (
        <>
          <div className="day-strip" role="group" aria-label="Дата">
            {days.map((d) => {
              const closed = d.total === 0;
              return (
                <button
                  key={d.date}
                  ref={(el) => {
                    if (el) chipRefs.current.set(d.date, el);
                  }}
                  type="button"
                  className="day-chip"
                  aria-pressed={selected?.date === d.date}
                  data-closed={closed || d.free === 0}
                  aria-label={`${formatInStudio(`${d.date}T12:00:00Z`, 'UTC', 'EEEE, d MMMM')}: ${
                    closed ? 'нет приёма' : d.free === 0 ? 'всё занято' : `свободно ${d.free}`
                  }`}
                  onClick={() => onPickDate(d.date)}
                >
                  <Text type="supporting" color="inherit">
                    {formatInStudio(`${d.date}T12:00:00Z`, 'UTC', 'EEEEEE')}
                  </Text>
                  <Text weight="semibold" color="inherit" hasTabularNumbers>
                    {formatInStudio(`${d.date}T12:00:00Z`, 'UTC', 'd')}
                  </Text>
                  <Text type="supporting" color={d.free ? 'accent' : 'inherit'}>
                    {closed ? '—' : d.free ? `${d.free}` : 'нет'}
                  </Text>
                </button>
              );
            })}
          </div>

          {selected ? (
            <VStack gap={2}>
              <Text weight="semibold">{formatInStudio(`${selected.date}T12:00:00Z`, 'UTC', 'EEEE, d MMMM')}</Text>
              {selected.total === 0 ? (
                <Text color="secondary">В этот день студия не принимает машины на эту услугу.</Text>
              ) : (
                <>
                  <div className="slot-grid" role="group" aria-label="Время">
                    {selected.slots.map((s) => (
                      <button
                        key={s.starts_at}
                        type="button"
                        className="slot"
                        disabled={!s.available}
                        aria-pressed={start === s.starts_at}
                        aria-label={s.available ? `${s.time}, свободно` : `${s.time}, занято`}
                        onClick={() => onPickStart(s.starts_at)}
                      >
                        {s.time}
                      </button>
                    ))}
                  </div>
                  <Text type="supporting" color="secondary">
                    Зачёркнутое время уже занято.
                  </Text>
                </>
              )}
              {selected.total > 0 && selected.free === 0 && firstFree ? (
                <Button
                  label={`Ближайшее свободное: ${formatInStudio(`${firstFree.date}T12:00:00Z`, 'UTC', 'd MMMM')}`}
                  variant="secondary"
                  onClick={() => onPickDate(firstFree.date)}
                />
              ) : null}
            </VStack>
          ) : null}

          {!firstFree ? (
            <Banner
              status="warning"
              title="На ближайшие две недели всё занято"
              description="Позвоните в студию — иногда освобождается время, которое ещё не видно онлайн."
            />
          ) : null}
        </>
      ) : null}
    </VStack>
  );
}
