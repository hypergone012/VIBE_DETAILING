import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Outlet, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '@astryxdesign/core/theme';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Center } from '@astryxdesign/core/Center';
import { publicApi } from '@/api/publicApi';
import { humanError, isApiError } from '@/api/errors';
import type { PublicTenant } from '@/api/schemas';
import { local } from '@/lib/storage';
import { studioTheme } from '@/theme/studioTheme';
import type { Boot } from '@/app/boot';
import { envError } from '@/lib/env';

export interface TenantContextValue {
  slug: string;
  data: PublicTenant;
  isPreview: boolean;
  /** Data shown from this device's cache because the network is unavailable. */
  isStale: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used inside TenantRoot');
  return ctx;
}

export const tenantQueryKey = (slug: string) => ['tenant', slug] as const;
const cacheKey = (slug: string) => `tenant-cache:${slug}`;

/**
 * Public studio data. Cached on the device (public info only) so the studio page
 * opens offline: the saved copy is initial data marked stale (updatedAt 0), so it
 * renders at once and is refreshed from the network whenever there is one.
 */
export function useTenantQuery(slug: string) {
  return useQuery({
    queryKey: tenantQueryKey(slug),
    queryFn: async () => {
      const data = await publicApi.tenant(slug);
      local.set(cacheKey(slug), data);
      return data;
    },
    initialData: () => local.get<PublicTenant | undefined>(cacheKey(slug), undefined),
    initialDataUpdatedAt: 0,
  });
}

function Shell({ accent, children }: { accent: string | null | undefined; children: ReactNode }) {
  const theme = useMemo(() => studioTheme(accent), [accent]);
  return (
    <Theme theme={theme} mode="dark">
      {children}
    </Theme>
  );
}

export function TenantRoot({ boot }: { boot: Boot }) {
  const { slug = '' } = useParams();
  const query = useTenantQuery(slug);
  const accent = query.data?.tenant.accent_color ?? boot.accent;

  useEffect(() => {
    if (query.data) {
      document.documentElement.dataset.appReady = 'true';
      document.getElementById('root')?.setAttribute('data-app-ready', 'true');
    }
  }, [query.data]);

  if (envError) {
    return (
      <Shell accent={accent}>
        <Center minHeight="100dvh" padding={6}>
          <EmptyState title="Приложение не настроено" description={envError} />
        </Center>
      </Shell>
    );
  }

  if (query.data) {
    const value: TenantContextValue = {
      slug,
      data: query.data,
      isPreview: query.data.tenant.status === 'preview',
      // Showing the device copy: offline (query paused), or the refresh failed.
      isStale: query.fetchStatus === 'paused' || (query.isError && !query.isFetching),
    };
    return (
      <Shell accent={accent}>
        <TenantContext.Provider value={value}>
          <Outlet />
        </TenantContext.Provider>
      </Shell>
    );
  }

  if (query.isError) {
    const notFound = isApiError(query.error, 'tenant_not_found');
    return (
      <Shell accent={accent}>
        <Center minHeight="100dvh" padding={6}>
          <VStack gap={4} hAlign="center" maxWidth={420}>
            <EmptyState
              title={notFound ? 'Студия не найдена' : 'Не удалось загрузить студию'}
              description={
                notFound
                  ? 'Ссылка устарела или студия ещё не опубликована. Уточните адрес у студии.'
                  : humanError(query.error)
              }
              actions={notFound ? undefined : <Button label="Повторить" variant="primary" onClick={() => void query.refetch()} />}
            />
          </VStack>
        </Center>
      </Shell>
    );
  }

  return (
    <Shell accent={accent}>
      <Center minHeight="100dvh">
        <Spinner size="lg" label={boot.name ? `Загружаем ${boot.name}` : 'Загружаем студию'} />
      </Center>
    </Shell>
  );
}
