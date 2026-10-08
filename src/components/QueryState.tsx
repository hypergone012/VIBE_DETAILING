import type { ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { humanError } from '@/api/errors';

/** Loading skeleton rows. */
export function LoadingRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <VStack gap={2} aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width="100%" height={56} radius={3} index={i} />
      ))}
    </VStack>
  );
}

/** Error state with retry for any failed query. */
export function ErrorState({ error, onRetry, title = 'Не удалось загрузить' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Banner
      status="error"
      title={title}
      description={humanError(error)}
      endContent={onRetry ? <Button label="Повторить" size="sm" onClick={onRetry} /> : undefined}
    />
  );
}

export function Maybe({ when, children }: { when: unknown; children: ReactNode }) {
  return when ? <>{children}</> : null;
}
