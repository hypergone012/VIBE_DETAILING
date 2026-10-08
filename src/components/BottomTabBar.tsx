import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { CalendarCheck, House, ListBullets } from '@phosphor-icons/react';
import { GlassPane, useLiquidGlass } from './useLiquidGlass';

interface Props {
  base: string;
  myCount: number;
}

/** Fixed glass navigation. Pages reserve its height (.app-page padding) so nothing hides under it. */
export function BottomTabBar({ base, myCount }: Props) {
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

  const items = [
    { to: `${base}/`, label: 'Главная', icon: House, end: true },
    { to: `${base}/services`, label: 'Услуги', icon: ListBullets, end: false },
    { to: `${base}/my`, label: myCount > 0 ? `Моя запись (${myCount})` : 'Моя запись', icon: CalendarCheck, end: false },
  ];

  return (
    <nav ref={ref} className="tabbar glass" aria-label="Основная навигация">
      <GlassPane ref={pane} />
      <ul className="tabbar__list glass__label">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className="tabbar__item">
              <Icon aria-hidden weight="bold" />
              <span>{label.replace(/ \(\d+\)$/, '')}</span>
              {myCount > 0 && label.startsWith('Моя') ? <span className="sr-only">: {myCount}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
