import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { BellRinging, CalendarPlus } from '@phosphor-icons/react';
import type { PublicBooking } from '@/api/schemas';
import { formatInStudio } from '@/lib/format';
import { buildIcs, downloadIcs } from '@/lib/ics';
import { enableReminder, initialReminderState, type ReminderState } from '@/pwa/push';

function describe(state: ReminderState, timezone: string): { status: 'info' | 'success' | 'warning' | 'error'; title: string; text?: string } | null {
  switch (state.kind) {
    case 'scheduled':
      return {
        status: 'success',
        title: 'Напоминание включено',
        text: state.at ? `Пришлём уведомление ${formatInStudio(state.at, timezone, 'd MMMM в HH:mm')}.` : undefined,
      };
    case 'preview':
      return { status: 'info', title: 'Это образец студии', text: 'Подписка сохранена, но в образце уведомления не отправляются.' };
    case 'too_late':
      return { status: 'info', title: 'До визита меньше двух часов', text: 'Напоминание уже не понадобится — ждём вас!' };
    case 'needs_install':
      return {
        status: 'info',
        title: 'На iPhone уведомления работают только из приложения',
        text: 'Нажмите «Поделиться» → «На экран Домой», откройте приложение и включите напоминание там. Или добавьте запись в календарь.',
      };
    case 'unsupported':
      return { status: 'info', title: 'Этот браузер не поддерживает уведомления', text: 'Добавьте запись в календарь — он напомнит за день.' };
    case 'not_configured':
      return { status: 'info', title: 'Уведомления пока не настроены', text: 'Добавьте запись в календарь — он напомнит за день.' };
    case 'denied':
      return {
        status: 'warning',
        title: 'Уведомления запрещены в настройках',
        text: 'Разрешите уведомления для этого сайта в настройках браузера или добавьте запись в календарь.',
      };
    case 'error':
      return { status: 'error', title: 'Не удалось включить напоминание', text: state.message };
    default:
      return null;
  }
}

/** "Напомнить за сутки" with honest states, plus an .ics file where push is unavailable. */
export function ReminderPanel({ booking, token, slug }: { booking: PublicBooking; token: string; slug: string }) {
  const [state, setState] = useState<ReminderState>(() => initialReminderState(slug, booking.code));
  const [busy, setBusy] = useState(false);
  const [icsSaved, setIcsSaved] = useState<boolean | null>(null);
  const info = describe(state, booking.studio.timezone);
  const active = booking.status === 'confirmed';

  const saveIcs = () => {
    const ok = downloadIcs(
      `zapis-${booking.code}.ics`,
      buildIcs({
        uid: `${booking.code}@${booking.studio.slug}`,
        start: booking.starts_at,
        end: booking.ends_at,
        title: `${booking.service_name} — ${booking.studio.name}`,
        location: booking.studio.address,
        description: `Код записи ${booking.code}. Телефон студии: ${booking.studio.phone_display ?? booking.studio.phone ?? ''}`,
        url: `${window.location.origin}/s/${slug}/my/${booking.code}`,
      }),
    );
    setIcsSaved(ok);
  };

  if (!active) return null;

  return (
    <VStack gap={3}>
      {state.kind === 'available' ? (
        <Button
          label="Напомнить за сутки"
          variant="primary"
          icon={<BellRinging weight="bold" />}
          isLoading={busy}
          onClick={async () => {
            setBusy(true);
            setState(await enableReminder(slug, booking.code, token));
            setBusy(false);
          }}
        />
      ) : null}
      {info ? <Banner status={info.status} title={info.title} description={info.text} /> : null}
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button label="Добавить в календарь" variant="secondary" icon={<CalendarPlus weight="bold" />} onClick={saveIcs} />
        {icsSaved === true ? (
          <Text type="supporting" color="secondary" role="status">
            Файл календаря скачан — откройте его, чтобы добавить событие с напоминанием за день.
          </Text>
        ) : null}
        {icsSaved === false ? (
          <Text type="supporting" color="secondary" role="status">
            Браузер не дал скачать файл. Запишите время: {formatInStudio(booking.starts_at, booking.studio.timezone, 'd MMMM, HH:mm')}.
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}
