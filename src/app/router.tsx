import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';
import { TenantRoot } from '@/features/tenant/TenantRoot';
import { ClientLayout } from '@/features/client/ClientLayout';
import { HomePage } from '@/features/home/HomePage';
import { ServicesPage } from '@/features/services/ServicesPage';
import type { Boot } from './boot';
import { NeutralLanding } from './NeutralLanding';
import { RouteError } from './RouteError';

const OwnerApp = lazy(() => import('@/features/owner/OwnerApp'));
const FoundationCheck = lazy(() => import('@/features/dev/FoundationCheck').then((m) => ({ default: m.FoundationCheck })));

const fallback = (
  <Center minHeight="100dvh">
    <Spinner size="lg" label="Загружаем" />
  </Center>
);

export function createRouter(boot: Boot) {
  return createBrowserRouter([
    {
      path: '/s/:slug',
      element: <TenantRoot boot={boot} />,
      errorElement: <RouteError />,
      children: [
        {
          element: <ClientLayout />,
          children: [
            { index: true, element: <HomePage /> },
            { path: 'services', element: <ServicesPage /> },
            // Secondary screens are separate chunks: the studio page stays light on phones.
            { path: 'my', lazy: async () => ({ Component: (await import('@/features/mybooking/MyBookingsPage')).MyBookingsPage }) },
            {
              path: 'my/:code',
              lazy: async () => ({ Component: (await import('@/features/mybooking/MyBookingsPage')).BookingDetailPage }),
            },
            { path: 'assistant', lazy: async () => ({ Component: (await import('@/features/assistant/AssistantPage')).AssistantPage }) },
            { path: 'privacy', lazy: async () => ({ Component: (await import('@/features/privacy/PrivacyPage')).PrivacyPage }) },
          ],
        },
        {
          path: 'owner/*',
          element: (
            <Suspense fallback={fallback}>
              <OwnerApp />
            </Suspense>
          ),
        },
      ],
    },
    {
      path: '/__foundation',
      element: (
        <Suspense fallback={fallback}>
          <FoundationCheck />
        </Suspense>
      ),
    },
    { path: '/', element: <NeutralLanding /> },
    { path: '*', element: <NeutralLanding notFound /> },
  ]);
}
