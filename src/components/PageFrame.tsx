import type { ReactNode } from 'react';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { useMediaQuery } from '@astryxdesign/core/hooks';

export const WIDE_QUERY = '(min-width: 1024px)';

/** True on tablets in landscape and desktops: two-column layouts switch on here. */
export const useIsWide = () => useMediaQuery(WIDE_QUERY);

/**
 * Page frame from the Astryx templates (Layout → LayoutContent with a content
 * width): 16px gutters on phones, 24px on wide screens. The <main> landmark
 * reserves room for the bottom tab bar and safe areas (see .app-main).
 */
export function PageFrame({
  children,
  width = 1120,
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
        contentWidth={width}
        content={
          <LayoutContent padding={wide ? 6 : 4} isScrollable={false}>
            {children}
          </LayoutContent>
        }
      />
    </main>
  );
}
