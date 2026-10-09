import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarPlus, MapPin, Phone } from '@phosphor-icons/react';
import { mediaUrl } from '@/api/client';
import { useIsWide } from '@/components/PageFrame';
import { GlassPane, useLiquidGlass } from '@/components/useLiquidGlass';
import { Photo } from '@/components/Photo';
import { formatPhoneHref } from '@/lib/format';
import { useTenant } from '@/features/tenant/TenantRoot';

/**
 * Full-bleed hero photo (contained with rounded corners on wide screens) with the
 * glass "Записаться" button. The button lives inside the hero, so it scrolls with
 * the photo. The lens refracts ONLY the photo (snapshot = .hero__media), so text
 * from neighbouring sections never shows up inside it; the label sits above the
 * lens and stays crisp.
 */
export function Hero({ onBook }: { onBook: () => void }) {
  const { data } = useTenant();
  const t = data.tenant;
  const wide = useIsWide();
  const ctaRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLSpanElement>(null);
  const [imageReady, setImageReady] = useState(false);
  useLiquidGlass(
    ctaRef,
    paneRef,
    { snapshot: '.hero__media', zIndex: 3, resolution: 2, enabled: imageReady, tint: 'rgba(255, 255, 255, 0.1)' },
    [imageReady, wide],
  );
  const phoneHref = formatPhoneHref(t.phone);
  const heroSrc = mediaUrl(t.hero_path);
  // "Город, улица, дом (примечание)" → the part people recognise at a glance.
  const place = t.address?.replace(/\s*\(.*\)\s*$/, '');

  return (
    <header className="hero">
      {heroSrc ? (
        <img
          className="hero__media"
          src={heroSrc}
          alt={t.hero_alt ?? t.name}
          crossOrigin="anonymous"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setImageReady(true)}
        />
      ) : (
        <span className="hero__media media-fallback" role="img" aria-label={t.name} />
      )}
      <span className="hero__scrim" aria-hidden />

      <HStack gap={3} vAlign="center" justify="between" className="hero__top">
        <HStack gap={2} vAlign="center">
          {t.logo_path ? <Photo path={t.logo_path} alt="" className="hero__logo" eager /> : null}
          <Text weight="semibold">{t.short_name}</Text>
        </HStack>
        {phoneHref ? (
          <Button label="Позвонить в студию" isIconOnly icon={<Phone weight="bold" />} variant="secondary" href={phoneHref} />
        ) : null}
      </HStack>

      <VStack gap={5} className="hero__content">
        <VStack gap={3}>
          {place ? (
            <HStack gap={1.5} vAlign="center">
              <MapPin size={16} weight="bold" aria-hidden className="hero__pin" />
              <Text type="supporting" color="secondary" maxLines={1}>
                {place}
              </Text>
            </HStack>
          ) : null}
          <Heading level={1} type={wide ? 'display-1' : 'display-2'} textWrap="balance">
            {t.name}
          </Heading>
          {t.tagline ? (
            <VStack maxWidth={560}>
              <Text type="large" color="secondary" textWrap="pretty">
                {t.tagline}
              </Text>
            </VStack>
          ) : null}
        </VStack>
        <VStack gap={3} className="hero__actions">
          <button ref={ctaRef} type="button" className="glass hero-cta" onClick={onBook} data-testid="hero-book">
            <GlassPane ref={paneRef} />
            <span className="glass-rim" aria-hidden />
            <span className="glass__label hero-cta__label">
              <CalendarPlus weight="bold" aria-hidden className="hero-cta__accent" />
              Записаться
            </span>
          </button>
        </VStack>
      </VStack>
    </header>
  );
}
