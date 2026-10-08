import { useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/lib/platform';

/**
 * Fades a section in when it scrolls into view. With "reduce motion" enabled the
 * content is shown immediately (and the CSS disables the transition as well).
 */
export function Reveal({ children, as: Tag = 'section', className, ...rest }: {
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  className?: string;
  'aria-labelledby'?: string;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(() => prefersReducedMotion() || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <Tag ref={ref as never} className={['reveal', className].filter(Boolean).join(' ')} data-visible={visible} {...rest}>
      {children}
    </Tag>
  );
}
