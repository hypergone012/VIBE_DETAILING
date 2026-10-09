import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';

/** Preview studios are marked on every screen: demo bookings, no real notifications. */
export function PreviewRibbon() {
  return (
    <p className="preview-ribbon" role="note">
      <StatusDot variant="warning" label="Образец" />
      <Text type="supporting" color="secondary">
        <Text type="supporting" weight="semibold" color="primary">
          Образец студии:
        </Text>{' '}
        записи тестовые, без уведомлений
      </Text>
    </p>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function OfflineBanner({ stale }: { stale: boolean }) {
  const online = useOnline();
  if (online && !stale) return null;
  return (
    <Banner
      status="warning"
      title="Нет подключения к интернету"
      description="Показываем сохранённые данные студии. Запись и свободное время станут доступны, когда связь вернётся."
    />
  );
}
