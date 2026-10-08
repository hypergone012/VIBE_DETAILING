import { useMemo } from 'react';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { LinkProvider } from '@astryxdesign/core/Link';
import ruRU from '@astryxdesign/core/locales/ru-RU.generated.js';
import { Theme } from '@astryxdesign/core/theme';
import { studioTheme } from '@/theme/studioTheme';
import type { Boot } from './boot';
import { createQueryClient } from './queryClient';
import { RouterLink } from './RouterLink';
import { createRouter } from './router';

export function App({ boot }: { boot: Boot }) {
  const queryClient = useMemo(() => createQueryClient(), []);
  const router = useMemo(() => createRouter(boot), [boot]);
  return (
    <InternationalizationProvider locale="ru-RU" messages={{ 'ru-RU': ruRU }}>
      <LinkProvider component={RouterLink}>
        <QueryClientProvider client={queryClient}>
          {/* Root theme for portals before the studio accent is known. */}
          <Theme theme={studioTheme(boot.accent)} mode="dark">
            <RouterProvider router={router} />
          </Theme>
        </QueryClientProvider>
      </LinkProvider>
    </InternationalizationProvider>
  );
}
