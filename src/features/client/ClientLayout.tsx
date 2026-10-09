import { lazy, Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { useToast } from '@astryxdesign/core/Toast';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopNav } from '@/components/DesktopNav';
import { useIsWide } from '@/components/PageFrame';
import { OfflineBanner, PreviewRibbon } from '@/components/StatusBanners';
import { useTenant } from '@/features/tenant/TenantRoot';
import { listBookings } from '@/lib/bookingVault';
import { applyUpdate, onUpdateAvailable, registerStudioWorker } from '@/pwa/registerServiceWorker';
import { useNow } from '@/lib/useNow';

const loadSheet = () => import('@/features/booking/BookingSheet');
const BookingSheet = lazy(async () => ({ default: (await loadSheet()).BookingSheet }));

export function ClientLayout() {
  const { slug, isPreview, isStale, data } = useTenant();
  const location = useLocation();
  const showToast = useToast();
  const [params] = useSearchParams();
  const sheetRequested = params.get('book') === '1';
  // Mount the sheet on first use and keep it mounted so the close animation runs.
  const [sheetMounted, setSheetMounted] = useState(sheetRequested);
  if (sheetRequested && !sheetMounted) setSheetMounted(true);

  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const preload = () => void loadSheet();
    if (idle) idle(preload);
    else window.setTimeout(preload, 2000);
  }, []);
  const wide = useIsWide();
  const now = useNow();
  const upcoming = listBookings(slug).filter((b) => new Date(b.startsAt).getTime() > now - 86_400_000).length;

  useEffect(() => {
    void registerStudioWorker(slug);
    return onUpdateAvailable(() =>
      showToast({
        body: 'Доступна новая версия приложения',
        isAutoHide: false,
        uniqueID: 'sw-update',
        endContent: <Button label="Обновить" size="sm" onClick={applyUpdate} />,
      }),
    );
  }, [slug, showToast]);

  useEffect(() => {
    document.title = `${data.tenant.name} — онлайн-запись`;
  }, [data.tenant.name]);

  // Focus management on navigation: move focus to the new page's content.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('book') === '1') return;
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <a className="sr-only skip-link" href="#main">
        К содержимому
      </a>
      {isPreview ? <PreviewRibbon /> : null}
      <OfflineBanner stale={isStale} />
      {wide ? <DesktopNav myCount={upcoming} /> : null}
      <Outlet />
      {wide ? null : <BottomTabBar base={`/s/${slug}`} myCount={upcoming} />}
      {sheetMounted ? (
        <Suspense fallback={null}>
          <BookingSheet />
        </Suspense>
      ) : null}
    </>
  );
}
