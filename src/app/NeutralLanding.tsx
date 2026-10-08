import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Theme } from '@astryxdesign/core/theme';
import { studioTheme } from '@/theme/studioTheme';

/** Root URL: studios are reached by their own link (/s/{slug}/); no public list. */
export function NeutralLanding({ notFound = false }: { notFound?: boolean }) {
  return (
    <Theme theme={studioTheme(null)} mode="dark">
      <Center minHeight="100dvh" padding={6}>
        <EmptyState
          title={notFound ? 'Страница не найдена' : 'Откройте ссылку вашей студии'}
          description={
            notFound
              ? 'Проверьте адрес. Ссылка на запись выглядит так: /s/название-студии/'
              : 'Онлайн-запись открывается по персональной ссылке студии. Попросите ссылку у администратора.'
          }
        />
      </Center>
    </Theme>
  );
}
