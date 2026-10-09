import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { GlassPane, useLiquidGlass } from './useLiquidGlass';

export interface TabItem {
  to: string;
  label: string;
  icon: PhosphorIcon;
  /** Match the path exactly (index tabs). */
  end?: boolean;
  /** Count announced to screen readers (e.g. upcoming bookings). */
  count?: number;
}

/** Fixed glass navigation for phones. Pages reserve its height (.app-main padding). */
export function BottomTabBar({ items, label = 'Основная навигация' }: { items: TabItem[]; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  const pane = useRef<HTMLSpanElement>(null);
  const location = useLocation();
  // Content scrolls under the bar: strong frost and a dark tint keep labels legible.
  useLiquidGlass(
    ref,
    pane,
    { zIndex: 40, resolution: 1, frost: 10, tint: 'rgba(0, 0, 0, 0.5)', dynamic: '.reveal' },
    [location.pathname],
  );

  return (
    <nav ref={ref} className="tabbar glass" aria-label={label}>
      <GlassPane ref={pane} />
      <ul className="tabbar__list glass__label">
        {items.map(({ to, label: text, icon: Icon, end, count }) => (
          <li key={to}>
            <NavLink to={to} end={end} className="tabbar__item">
              <Icon aria-hidden weight="bold" />
              <span>{text}</span>
              {count ? <span className="sr-only">: {count}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
