import type { ReactNode } from 'react';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';

export const WIDE_QUERY = '(min-width: 1024px)';

/** True on tablets in landscape and desktops: two-column layouts switch on here. */
export const useIsWide = () => useMediaQuery(WIDE_QUERY);

/** Shared content grid: every page aligns its left edge with the top navigation. */
const FRAME_WIDTH = 1120;

/**
 * Page frame from the Astryx templates (Layout → LayoutContent with a content
 * width): 16px gutters on phones, 24px on wide screens. `width` is the readable
 * column inside the shared 1120px grid, aligned to its start edge. The <main>
 * landmark reserves room for the bottom tab bar and safe areas (see .app-main).
 */
export function PageFrame({
  children,
  width = FRAME_WIDTH,
  className,
  fill = false,
}: {
  children: ReactNode;
  width?: number;
  className?: string;
  /** Fill the viewport height (chat): the page itself does not scroll. */
  fill?: boolean;
}) {
  const wide = useIsWide();
  return (
    <main className={['app-main', className].filter(Boolean).join(' ')} id="main" tabIndex={-1}>
      <Layout
        height={fill ? 'fill' : 'auto'}
        contentWidth={FRAME_WIDTH}
        content={
          <LayoutContent padding={wide ? 6 : 4} isScrollable={false}>
            {width < FRAME_WIDTH ? (
              <VStack width="100%" maxWidth={width} height={fill ? '100%' : undefined}>
                {children}
              </VStack>
            ) : (
              children
            )}
          </LayoutContent>
        }
      />
    </main>
  );
}
