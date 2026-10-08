import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';

/** Last-resort error screen for a crashed route (with a real recovery action). */
export function RouteError() {
  const error = useRouteError();
  const isChunk = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  console.error(error);
  return (
    <Center minHeight="100dvh" padding={6}>
      <EmptyState
        title={isRouteErrorResponse(error) && error.status === 404 ? 'Страница не найдена' : 'Что-то пошло не так'}
        description={isChunk ? 'Приложение обновилось. Перезагрузите страницу.' : 'Перезагрузите страницу. Если не поможет — позвоните в студию.'}
        actions={<Button label="Перезагрузить" variant="primary" onClick={() => window.location.reload()} />}
      />
    </Center>
  );
}
