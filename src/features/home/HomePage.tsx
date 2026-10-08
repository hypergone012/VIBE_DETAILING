import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import {
  ArrowRight,
  Camera,
  Car,
  ChatCircleDots,
  Clock,
  Coffee,
  Drop,
  MapPin,
  Medal,
  NavigationArrow,
  Phone,
  ShieldCheck,
  Sparkle,
  Star,
  Wrench,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { mediaUrl } from '@/api/client';
import { Photo } from '@/components/Photo';
import { Reveal } from '@/components/Reveal';
import { useBookingRoute } from '@/features/booking/useBookingRoute';
import { useTenant } from '@/features/tenant/TenantRoot';
import { formatDuration, formatMoney, formatPhoneHref, isoWeekday, studioToday, WEEKDAY_NAMES } from '@/lib/format';
import { useInstallPrompt } from '@/pwa/install';
import { Hero } from './Hero';
import { NextSlotHint } from './NextSlotHint';

const CARD_ICONS: Record<string, PhosphorIcon> = {
  sparkle: Sparkle,
  shield: ShieldCheck,
  clock: Clock,
  drop: Drop,
  car: Car,
  star: Star,
  wrench: Wrench,
  medal: Medal,
  coffee: Coffee,
  camera: Camera,
};

export function assistantExamples(serviceNames: string[]): string[] {
  const priceTarget =
    serviceNames.find((n) => /полиров/i.test(n)) ?? serviceNames[1] ?? serviceNames[0] ?? 'мойка';
  return ['Когда ближайшее окно?', `Сколько стоит ${priceTarget.toLowerCase()}?`, 'Как найти студию?'];
}

export function HomePage() {
  const { slug, data } = useTenant();
  const { open } = useBookingRoute();
  const navigate = useNavigate();
  const t = data.tenant;
  const base = `/s/${slug}`;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const install = useInstallPrompt();
  const bookable = data.services.filter((s) => s.bookable);
  const examples = useMemo(() => assistantExamples(bookable.map((s) => s.name)), [bookable]);
  const phoneHref = formatPhoneHref(t.phone);

  return (
    <>
      <Hero onBook={() => open()} />
      <main className="app-page" id="main" tabIndex={-1}>
        <VStack gap={10} paddingBlockStart={6}>
          {/* Booking card under a prominent heading */}
          <Reveal aria-labelledby="book-heading">
            <VStack gap={3}>
              <Heading level={2} type="display-3" id="book-heading">
                Запись в студию
              </Heading>
              <Card padding={5} elevation="low">
                <VStack gap={4}>
                  <Text>Выберите услугу и свободное время — бокс подготовят к вашему приезду. Регистрация не нужна.</Text>
                  <NextSlotHint />
                  <Button label="Выбрать услугу и время" variant="primary" size="lg" width="100%" onClick={() => open()} />
                </VStack>
              </Card>
            </VStack>
          </Reveal>

          {t.info_cards.length ? (
            <Reveal aria-label="О студии">
              <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={3}>
                {t.info_cards.map((c) => {
                  const Icon = CARD_ICONS[c.icon] ?? Sparkle;
                  return (
                    <Card key={c.title} padding={4} variant="muted">
                      <VStack gap={2}>
                        <Icon size={28} weight="duotone" color="var(--color-icon-accent)" aria-hidden />
                        <Text weight="semibold">{c.title}</Text>
                        <Text color="secondary">{c.text}</Text>
                      </VStack>
                    </Card>
                  );
                })}
              </Grid>
            </Reveal>
          ) : null}

          {t.description ? (
            <Reveal aria-label="Описание">
              <Text type="large" textWrap="pretty">
                {t.description}
              </Text>
            </Reveal>
          ) : null}

          <Reveal aria-labelledby="services-heading">
            <VStack gap={3}>
              <HStack justify="between" vAlign="center">
                <Heading level={2} id="services-heading">
                  Услуги и цены
                </Heading>
                <Button label="Все услуги" variant="ghost" size="sm" href={`${base}/services`} endContent={undefined} />
              </HStack>
              <List hasDividers density="spacious" edgeCompensation="inline">
                {bookable.slice(0, 5).map((s) => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    description={formatDuration(s.duration_minutes)}
                    endContent={
                      <Text weight="semibold" hasTabularNumbers>
                        {formatMoney(s.price_minor, t.currency, s.price_is_from)}
                      </Text>
                    }
                    onClick={() => open(s.id)}
                  />
                ))}
              </List>
            </VStack>
          </Reveal>

          {data.photos.length ? (
            <Reveal aria-labelledby="works-heading">
              <VStack gap={3}>
                <Heading level={2} id="works-heading">
                  Наши работы
                </Heading>
                <Grid columns={{ minWidth: 150, repeat: 'fill' }} gap={2}>
                  {data.photos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className="work-tile"
                      onClick={() => setLightboxIndex(i)}
                      aria-label={p.caption ? `Открыть фото: ${p.caption}` : `Открыть фото ${i + 1}`}
                    >
                      <Photo path={p.path} alt={p.caption ?? `Работа ${i + 1}`} />
                      {p.caption ? (
                        <Text type="supporting" color="secondary" maxLines={2}>
                          {p.caption}
                        </Text>
                      ) : null}
                    </button>
                  ))}
                </Grid>
                <Lightbox
                  isOpen={lightboxIndex !== null}
                  onOpenChange={(isOpen) => !isOpen && setLightboxIndex(null)}
                  index={lightboxIndex ?? 0}
                  onIndexChange={setLightboxIndex}
                  media={data.photos.map((p, i) => ({
                    type: 'image' as const,
                    src: mediaUrl(p.path) ?? '',
                    alt: p.caption ?? `Работа ${i + 1}`,
                    caption: p.caption ?? undefined,
                  }))}
                />
              </VStack>
            </Reveal>
          ) : null}

          <Reveal aria-labelledby="assistant-heading">
            <Card padding={5} variant="muted">
              <VStack gap={3}>
                <HStack gap={2} vAlign="center">
                  <ChatCircleDots size={26} weight="duotone" color="var(--color-icon-accent)" aria-hidden />
                  <Heading level={2} id="assistant-heading">
                    Спросите помощника
                  </Heading>
                </HStack>
                <Text color="secondary">Ответит про услуги, цены и свободное время этой студии.</Text>
                <HStack gap={2} wrap="wrap">
                  {examples.map((q) => (
                    <Token key={q} label={q} onClick={() => navigate(`${base}/assistant?q=${encodeURIComponent(q)}`)} />
                  ))}
                </HStack>
              </VStack>
            </Card>
          </Reveal>

          <Reveal aria-labelledby="contacts-heading">
            <ContactsSection />
          </Reveal>

          <VStack gap={3} paddingBlockEnd={4}>
            {install.canPrompt ? (
              <Button label="Установить приложение" variant="secondary" onClick={() => void install.prompt()} />
            ) : null}
            {install.iosManual ? (
              <Text type="supporting" color="secondary">
                Чтобы открывать запись как приложение: «Поделиться» → «На экран Домой».
              </Text>
            ) : null}
            <HStack gap={3} wrap="wrap">
              {phoneHref ? <Button label={t.phone_display ?? t.phone ?? ''} variant="ghost" size="sm" icon={<Phone />} href={phoneHref} /> : null}
              <Button label="Как используются данные" variant="ghost" size="sm" href={`${base}/privacy`} />
            </HStack>
          </VStack>
        </VStack>
      </main>
    </>
  );
}

function ContactsSection() {
  const { data } = useTenant();
  const t = data.tenant;
  const today = studioToday(t.timezone);
  const todayWeekday = isoWeekday(today);
  const byDay = WEEKDAY_NAMES.map((name, i) => ({
    name,
    weekday: i + 1,
    windows: data.hours.filter((h) => h.weekday === i + 1),
  }));
  const special = data.exceptions.slice(0, 4);

  return (
    <VStack gap={4}>
      <Heading level={2} id="contacts-heading">
        Адрес и время работы
      </Heading>
      {t.address ? (
        <VStack gap={2}>
          <HStack gap={2} vAlign="start">
            <MapPin size={22} weight="duotone" color="var(--color-icon-accent)" aria-hidden />
            <VStack gap={1}>
              <Text weight="semibold">{t.address}</Text>
              {t.address_note ? <Text color="secondary">{t.address_note}</Text> : null}
            </VStack>
          </HStack>
          {t.map_url ? (
            <Button
              label="Открыть на карте"
              variant="secondary"
              icon={<NavigationArrow weight="bold" />}
              href={t.map_url}
              target="_blank"
              rel="noopener"
            />
          ) : null}
        </VStack>
      ) : null}
      <List density="compact" hasDividers>
        {byDay.map((d) => (
          <ListItem
            key={d.weekday}
            label={d.name}
            isSelected={d.weekday === todayWeekday}
            endContent={
              <Text hasTabularNumbers color={d.windows.length ? 'primary' : 'secondary'}>
                {d.windows.length ? d.windows.map((w) => `${w.opens_at}–${w.closes_at}`).join(', ') : 'выходной'}
              </Text>
            }
          />
        ))}
      </List>
      {special.length ? (
        <VStack gap={1}>
          <Text weight="semibold">Особые дни</Text>
          {special.map((e) => (
            <Text key={e.date} color="secondary">
              {new Date(`${e.date}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })}:{' '}
              {e.is_closed ? 'выходной' : `${e.opens_at}–${e.closes_at}`}
              {e.note ? ` · ${e.note}` : ''}
            </Text>
          ))}
        </VStack>
      ) : null}
      <Text type="supporting" color="secondary">
        <ArrowRight size={12} aria-hidden /> В эти часы студия принимает и выдаёт машины.
      </Text>
    </VStack>
  );
}
