import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/** Eyebrow + heading (+ optional action on the right), the one section header of the app. */
export function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  action,
  level = 2,
  size = 'section',
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  level?: 1 | 2 | 3;
  size?: 'page' | 'section';
}) {
  return (
    <HStack gap={3} vAlign="end" justify="between">
      <VStack gap={size === 'page' ? 2 : 1}>
        {eyebrow ? (
          <Text type="supporting" color="secondary" className="eyebrow">
            {eyebrow}
          </Text>
        ) : null}
        <Heading level={level} id={id} type={size === 'page' ? 'display-3' : undefined} textWrap="balance">
          {title}
        </Heading>
        {description ? (
          <Text color="secondary" textWrap="pretty">
            {description}
          </Text>
        ) : null}
      </VStack>
      {action}
    </HStack>
  );
}
