import { useLocation } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout } from '@astryxdesign/core/Layout';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { CalendarPlus, Phone } from '@phosphor-icons/react';
import { mediaUrl } from '@/api/client';
import { useBookingRoute } from '@/features/booking/useBookingRoute';
import { useTenant } from '@/features/tenant/TenantRoot';
import { formatPhoneHref } from '@/lib/format';

/** Wide screens: a sticky top navigation replaces the phone's bottom tab bar. */
export function DesktopNav({ myCount }: { myCount: number }) {
  const { slug, data } = useTenant();
  const { open } = useBookingRoute();
  const { pathname } = useLocation();
  const t = data.tenant;
  const base = `/s/${slug}`;
  const logo = mediaUrl(t.logo_path);
  const phoneHref = formatPhoneHref(t.phone);
  const items = [
    { href: `${base}/`, label: 'Главная', selected: pathname === `${base}/` || pathname === base },
    { href: `${base}/services`, label: 'Услуги', selected: pathname.startsWith(`${base}/services`) },
    { href: `${base}/my`, label: myCount > 0 ? `Моя запись · ${myCount}` : 'Моя запись', selected: pathname.startsWith(`${base}/my`) },
  ];

  return (
    <header className="desktop-nav">
      <Layout
        height="auto"
        contentWidth={1120}
        padding={6}
        content={
          <TopNav
            label="Основная навигация"
            heading={
              <TopNavHeading
                heading={t.short_name}
                headingHref={`${base}/`}
                logo={logo ? <img src={logo} alt="" className="desktop-nav__logo" crossOrigin="anonymous" /> : undefined}
              />
            }
            centerContent={
              <HStack gap={1}>
                {items.map((i) => (
                  <TopNavItem key={i.href} label={i.label} href={i.href} isSelected={i.selected} />
                ))}
              </HStack>
            }
            endContent={
              <HStack gap={2} vAlign="center">
                {phoneHref ? (
                  <Button label={t.phone_display ?? t.phone ?? ''} variant="ghost" icon={<Phone weight="bold" />} href={phoneHref} />
                ) : null}
                <Button label="Записаться" variant="primary" icon={<CalendarPlus weight="bold" />} onClick={() => open()} />
              </HStack>
            }
          />
        }
      />
    </header>
  );
}
