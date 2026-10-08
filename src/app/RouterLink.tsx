import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

/**
 * Astryx LinkProvider component: same-origin paths navigate client-side through
 * React Router; anything else (tel:, maps, external) stays a normal anchor.
 */
export const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(
  function RouterLink({ href = '', ...rest }, ref) {
    if (href.startsWith('/') && !href.startsWith('//') && !rest.target && !rest.download) {
      return <Link ref={ref} to={href} {...rest} />;
    }
    return <a ref={ref} href={href} {...rest} />;
  },
);
