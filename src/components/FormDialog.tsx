import type { ReactNode } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { useIsWide } from './PageFrame';

/**
 * Form in a dialog (Astryx DialogFormDialog template): header with close button,
 * scrolling content, pinned action row. Long forms go fullscreen on phones.
 */
export function FormDialog({
  isOpen,
  onOpenChange,
  title,
  subtitle,
  children,
  actions,
  tall = false,
  width = 480,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  tall?: boolean;
  width?: number;
}) {
  const wide = useIsWide();
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={width}
      maxHeight={tall ? '90dvh' : '80dvh'}
      variant={tall && !wide ? 'fullscreen' : 'standard'}
    >
      <Layout
        header={<DialogHeader title={title} subtitle={subtitle} onOpenChange={onOpenChange} />}
        content={<LayoutContent>{children}</LayoutContent>}
        footer={
          <LayoutFooter>
            <HStack gap={2} justify="end" wrap="wrap">
              {actions}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
