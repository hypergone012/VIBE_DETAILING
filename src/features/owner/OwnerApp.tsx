import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { VStack } from '@astryxdesign/core/VStack';
import { isApiError, humanError } from '@/api/errors';
import { ownerApi } from '@/api/ownerApi';
import { getOwnerClient } from '@/api/ownerClient';
import { useTenant } from '@/features/tenant/TenantRoot';
import { clearPrivateCaches, registerStudioWorker } from '@/pwa/registerServiceWorker';
import { LoginPage } from './LoginPage';
import { OwnerContext, ownerKeys, type OwnerContextValue } from './OwnerContext';
import { OwnerShell } from './OwnerShell';
import { SchedulePage } from './SchedulePage';

const BookingPage = lazy(() => import('./BookingPage').then((m) => ({ default: m.BookingPage })));
const NewBookingPage = lazy(() => import('./NewBookingPage').then((m) => ({ default: m.NewBookingPage })));
const StatsPage = lazy(() => import('./StatsPage').then((m) => ({ default: m.StatsPage })));
const OwnerAssistantPage = lazy(() => import('./OwnerAssistantPage').then((m) => ({ default: m.OwnerAssistantPage })));
const StudioPage = lazy(() => import('./studio/StudioPage').then((m) => ({ default: m.StudioPage })));

type AuthState = { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: Session };

/** Supabase Auth session of this studio's cabinet (storage key owner-auth:<slug>). */
function useOwnerAuth(slug: string): AuthState {
  const client = getOwnerClient(slug);
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? { status: 'signed_in', session: data.session } : { status: 'signed_out' });
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signed_in', session } : { status: 'signed_out' });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  return state;
}

const fullscreenSpinner = (label: string) => (
  <Center minHeight="100dvh">
    <Spinner size="lg" label={label} />
  </Center>
);

export default function OwnerApp() {
  const { slug, data } = useTenant();
  const auth = useOwnerAuth(slug);
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = `Кабинет — ${data.tenant.name}`;
    void registerStudioWorker(slug);
  }, [slug, data.tenant.name]);

  /** Logout: drop the session, every private query and the worker's runtime caches. */
  const signOut = useCallback(async () => {
    await getOwnerClient(slug).auth.signOut({ scope: 'local' });
    queryClient.removeQueries({ queryKey: ownerKeys.all(slug) });
    clearPrivateCaches();
  }, [slug, queryClient]);

  if (auth.status === 'loading') return fullscreenSpinner('Проверяем вход');
  if (auth.status === 'signed_out') return <LoginPage />;
  return <SignedIn session={auth.session} signOut={signOut} />;
}

function SignedIn({ session, signOut }: { session: Session; signOut: () => Promise<void> }) {
  const { slug } = useTenant();
  const api = useMemo(() => ownerApi(slug), [slug]);
  const me = useQuery({
    queryKey: ownerKeys.session(slug),
    queryFn: () => api.session(),
    retry: (count, error) => !isApiError(error, 'forbidden') && !isApiError(error, 'not_authenticated') && count < 2,
  });

  if (me.isPending) return fullscreenSpinner('Открываем кабинет');
  if (me.isError) {
    const forbidden = isApiError(me.error, 'forbidden') || isApiError(me.error, 'not_authenticated');
    return (
      <Center minHeight="100dvh" padding={6}>
        <VStack gap={4} hAlign="center" maxWidth={420}>
          <EmptyState
            title={forbidden ? 'Нет доступа к этой студии' : 'Не удалось открыть кабинет'}
            description={
              forbidden
                ? `Аккаунт ${session.user.email ?? ''} не привязан к этой студии. Войдите под аккаунтом владельца.`
                : humanError(me.error)
            }
            actions={
              <VStack gap={2}>
                {forbidden ? null : <Button label="Повторить" variant="primary" onClick={() => void me.refetch()} />}
                <Button label="Выйти" variant="secondary" onClick={() => void signOut()} />
              </VStack>
            }
          />
        </VStack>
      </Center>
    );
  }

  const value: OwnerContextValue = {
    slug,
    base: `/s/${slug}/owner`,
    api,
    session: me.data,
    accessToken: session.access_token,
    signOut,
  };

  return (
    <OwnerContext.Provider value={value}>
      <OwnerShell>
        <Suspense fallback={fullscreenSpinner('Загружаем')}>
          <Routes>
            <Route index element={<SchedulePage />} />
            <Route path="booking/:id" element={<BookingPage />} />
            <Route path="new" element={<NewBookingPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="assistant" element={<OwnerAssistantPage />} />
            <Route path="studio/*" element={<StudioPage />} />
            <Route path="*" element={<Navigate to="." replace />} />
          </Routes>
        </Suspense>
      </OwnerShell>
    </OwnerContext.Provider>
  );
}
