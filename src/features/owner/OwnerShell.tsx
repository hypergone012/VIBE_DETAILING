import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout } from '@astryxdesign/core/Layout';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { CalendarDots, ChartBar, ChatCircleDots, Plus, SignOut, Storefront } from '@phosphor-icons/react';
import { mediaUrl } from '@/api/client';
import { BottomTabBar, type TabItem } from '@/components/BottomTabBar';
import { useIsWide } from '@/components/PageFrame';
import { PreviewRibbon } from '@/components/StatusBanners';
import { useOwner } from './OwnerContext';

/**
 * Cabinet chrome: phones get the glass bottom tab bar (4 sections), wide screens a
 * sticky Astryx TopNav with "Новая запись" and sign-out.
 */
export function OwnerShell({ children }: { children: ReactNode }) {
  const { base, session, signOut } = useOwner();
  const wide = useIsWide();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  const items: TabItem[] = [
    { to: `${base}/`, label: 'Записи', icon: CalendarDots, end: true },
    { to: `${base}/stats`, label: 'Деньги', icon: ChartBar },
    { to: `${base}/assistant`, label: 'Помощник', icon: ChatCircleDots },
    { to: `${base}/studio`, label: 'Студия', icon: Storefront },
  ];
  const isSelected = (to: string, end?: boolean) =>
    end ? pathname === to || pathname === to.slice(0, -1) || pathname.startsWith(`${base}/booking`) || pathname === `${base}/new` : pathname.startsWith(to);
  const logo = mediaUrl(session.logo_path);

  return (
    <>
      <a className="sr-only skip-link" href="#main">
        К содержимому
      </a>
      {session.status === 'preview' ? <PreviewRibbon /> : null}
      {wide ? (
        <header className="desktop-nav">
          <Layout
            height="auto"
            contentWidth={1120}
            padding={6}
            content={
              <TopNav
                label="Разделы кабинета"
                heading={
                  <TopNavHeading
                    heading={session.name}
                    subheading="Кабинет"
                    headingHref={`${base}/`}
                    logo={logo ? <img src={logo} alt="" className="desktop-nav__logo" crossOrigin="anonymous" /> : undefined}
                  />
                }
                centerContent={
                  <HStack gap={1}>
                    {items.map((i) => (
                      <TopNavItem key={i.to} label={i.label} href={i.to} isSelected={isSelected(i.to, i.end)} />
                    ))}
                  </HStack>
                }
                endContent={
                  <HStack gap={2} vAlign="center">
                    <Button label="Новая запись" variant="primary" icon={<Plus weight="bold" />} href={`${base}/new`} />
                    <Button label="Выйти" variant="ghost" isIconOnly icon={<SignOut weight="bold" />} onClick={() => void signOut()} />
                  </HStack>
                }
              />
            }
          />
        </header>
      ) : null}
      {children}
      {wide ? null : <BottomTabBar items={items} label="Разделы кабинета" />}
    </>
  );
}
