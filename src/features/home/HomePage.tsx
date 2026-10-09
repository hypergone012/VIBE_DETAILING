import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Carousel } from '@astryxdesign/core/Carousel';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
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
  CaretRight,
  Clock,
  Coffee,
  Drop,
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
import { PageFrame, useIsWide } from '@/components/PageFrame';
import { Photo } from '@/components/Photo';
import { Reveal } from '@/components/Reveal';
import { SectionHeader } from '@/components/SectionHeader';
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
  const { open } = useBookingRoute();
  const wide = useIsWide();

  return (
    <>
      <Hero onBook={() => open()} />
      <PageFrame>
        {wide ? (
          // Desktop: content on the left, the booking card stays in view on the right
          // (Astryx product-detail template: sticky info column).
          <Grid columns={3} columnGap={10} align="start">
            <GridSpan columns={2} className="grid-cell">
              <MainSections />
            </GridSpan>
            <VStack className="sticky-aside grid-cell">
              <BookingCard />
            </VStack>
          </Grid>
        ) : (
          <VStack gap={10}>
            <BookingCard />
            <MainSections />
          </VStack>
        )}
      </PageFrame>
    </>
  );
}

/** "Запись в студию": the 3-step funnel in one card with the real nearest slot. */
function BookingCard() {
  const { data } = useTenant();
  const { open } = useBookingRoute();
  const rules = data.tenant.rules;
  const steps = [
    { title: 'Услуга', text: 'Цена и время работы сразу' },
    { title: 'Время', text: 'Только свободные окна' },
    { title: 'Контакты', text: 'Без регистрации' },
  ];

  return (
    <Reveal aria-labelledby="book-heading">
      <VStack gap={4}>
        <SectionHeader id="book-heading" eyebrow="Онлайн-запись" title="Запись в студию" />
        <Card padding={5} elevation="low">
          <VStack gap={5}>
            <List density="compact">
              {steps.map((s, i) => (
                <ListItem
                  key={s.title}
                  startContent={
                    <Text weight="semibold" color="accent" hasTabularNumbers className="step-index">
                      {i + 1}
                    </Text>
                  }
                  label={s.title}
                  description={s.text}
                />
              ))}
            </List>
            <Divider />
            <NextSlotHint />
            <Button label="Выбрать услугу и время" variant="primary" size="lg" width="100%" onClick={() => open()} />
            <Text type="supporting" color="secondary" textWrap="pretty">
              {rules.cancel_until_hours > 0
                ? `Отменить запись можно онлайн не позднее чем за ${rules.cancel_until_hours} ч до визита.`
                : 'Отменить запись можно онлайн в любой момент до визита.'}
            </Text>
          </VStack>
        </Card>
      </VStack>
    </Reveal>
  );
}

function MainSections() {
  const { slug, data } = useTenant();
  const { open } = useBookingRoute();
  const navigate = useNavigate();
  const t = data.tenant;
  const base = `/s/${slug}`;
  const bookable = data.services.filter((s) => s.bookable);
  const examples = useMemo(() => assistantExamples(bookable.map((s) => s.name)), [bookable]);

  return (
    <VStack gap={10}>
      {t.info_cards.length || t.description ? (
        <Reveal aria-labelledby="about-heading">
          <VStack gap={5}>
            <SectionHeader id="about-heading" eyebrow="О студии" title="Коротко о нас" />
            {t.description ? (
              <Text type="large" textWrap="pretty">
                {t.description}
              </Text>
            ) : null}
            {t.info_cards.length ? (
              <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={5}>
                {t.info_cards.map((c) => {
                  const Icon = CARD_ICONS[c.icon] ?? Sparkle;
                  return (
                    <VStack key={c.title} gap={2} className="fact">
                      <Icon size={24} aria-hidden className="icon-accent" />
                      <Text weight="semibold">{c.title}</Text>
                      <Text color="secondary" textWrap="pretty">
                        {c.text}
                      </Text>
                    </VStack>
                  );
                })}
              </Grid>
            ) : null}
          </VStack>
        </Reveal>
      ) : null}

      <Reveal aria-labelledby="services-heading">
        <VStack gap={3}>
          <SectionHeader
            id="services-heading"
            eyebrow="Прайс"
            title="Услуги и цены"
            action={<Button label="Все услуги" variant="ghost" size="sm" href={`${base}/services`} endContent={<ArrowRight aria-hidden />} />}
          />
          <List hasDividers density="spacious" edgeCompensation="inline">
            {bookable.slice(0, 6).map((s) => (
              <ListItem
                key={s.id}
                label={s.name}
                description={formatDuration(s.duration_minutes)}
                endContent={
                  <HStack gap={2} vAlign="center">
                    <Text weight="semibold" hasTabularNumbers>
                      {formatMoney(s.price_minor, t.currency, s.price_is_from)}
                    </Text>
                    <CaretRight size={16} aria-hidden className="icon-secondary" />
                  </HStack>
                }
                onClick={() => open(s.id)}
              />
            ))}
          </List>
        </VStack>
      </Reveal>

      {data.photos.length ? <WorksSection /> : null}

      <Reveal aria-labelledby="assistant-heading">
        <VStack gap={4}>
          <SectionHeader
            id="assistant-heading"
            eyebrow="Помощник"
            title="Спросите о студии"
            description="Ответит по прайсу, расписанию и адресу этой студии."
          />
          <HStack gap={2} wrap="wrap">
            {examples.map((q) => (
              <Token key={q} label={q} size="lg" onClick={() => navigate(`${base}/assistant?q=${encodeURIComponent(q)}`)} />
            ))}
          </HStack>
        </VStack>
      </Reveal>

      <Reveal aria-labelledby="contacts-heading">
        <ContactsSection />
      </Reveal>

      <FooterLinks />
    </VStack>
  );
}

function WorksSection() {
  const { data } = useTenant();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  return (
    <Reveal aria-labelledby="works-heading">
      <VStack gap={4}>
        <SectionHeader id="works-heading" eyebrow="Портфолио" title="Наши работы" />
        <Carousel aria-label="Фото работ студии" gap={3} hasSnap hasEdgeFade={false}>
          {data.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="work-tile"
              onClick={() => setLightboxIndex(i)}
              aria-label={p.caption ? `Открыть фото: ${p.caption}` : `Открыть фото ${i + 1}`}
            >
              <AspectRatio ratio={4 / 5}>
                <Photo path={p.path} alt={p.caption ?? `Работа ${i + 1}`} className="media-fill" />
              </AspectRatio>
              {p.caption ? (
                <Text type="supporting" color="secondary" maxLines={2} hasTruncateTooltip={false}>
                  {p.caption}
                </Text>
              ) : null}
            </button>
          ))}
        </Carousel>
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
  );
}

function ContactsSection() {
  const { data } = useTenant();
  const t = data.tenant;
  const today = studioToday(t.timezone);
  const todayWeekday = isoWeekday(today);
  const phoneHref = formatPhoneHref(t.phone);
  const byDay = WEEKDAY_NAMES.map((name, i) => ({
    name,
    weekday: i + 1,
    windows: data.hours.filter((h) => h.weekday === i + 1),
  }));
  const special = data.exceptions.slice(0, 4);

  return (
    <VStack gap={5}>
      <SectionHeader id="contacts-heading" eyebrow="Контакты" title="Адрес и время работы" />
      <Grid columns={{ minWidth: 280, repeat: 'fit' }} gap={8}>
        <VStack gap={4}>
          {t.address ? (
            <VStack gap={1}>
              <Text type="large" weight="semibold" textWrap="pretty">
                {t.address}
              </Text>
              {t.address_note ? (
                <Text color="secondary" textWrap="pretty">
                  {t.address_note}
                </Text>
              ) : null}
            </VStack>
          ) : null}
          <HStack gap={2} wrap="wrap">
            {t.map_url ? (
              <Button
                label="Маршрут"
                variant="secondary"
                icon={<NavigationArrow weight="bold" />}
                href={t.map_url}
                target="_blank"
                rel="noopener"
              />
            ) : null}
            {phoneHref ? (
              <Button label={t.phone_display ?? t.phone ?? 'Позвонить'} variant="secondary" icon={<Phone weight="bold" />} href={phoneHref} />
            ) : null}
          </HStack>
          <Text type="supporting" color="secondary">
            В эти часы студия принимает и выдаёт машины.
          </Text>
        </VStack>
        <VStack gap={3}>
          <List density="compact" hasDividers>
            {byDay.map((d) => (
              <ListItem
                key={d.weekday}
                label={d.name}
                isSelected={d.weekday === todayWeekday}
                endContent={
                  <HStack gap={2} vAlign="center">
                    {d.weekday === todayWeekday ? <Token label="сегодня" size="sm" /> : null}
                    <Text hasTabularNumbers color={d.windows.length ? 'primary' : 'secondary'}>
                      {d.windows.length ? d.windows.map((w) => `${w.opens_at}–${w.closes_at}`).join(', ') : 'выходной'}
                    </Text>
                  </HStack>
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
        </VStack>
      </Grid>
    </VStack>
  );
}

function FooterLinks() {
  const { slug, data } = useTenant();
  const install = useInstallPrompt();
  return (
    <VStack gap={3}>
      <Divider />
      {install.canPrompt ? (
        <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
          <Text color="secondary">Откройте запись как приложение — без магазина приложений.</Text>
          <Button label="Установить" variant="secondary" size="sm" onClick={() => void install.prompt()} />
        </HStack>
      ) : null}
      {install.iosManual ? (
        <Text type="supporting" color="secondary">
          Чтобы открывать запись как приложение: «Поделиться» → «На экран Домой».
        </Text>
      ) : null}
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <Text type="supporting" color="secondary">
          {data.tenant.name}
        </Text>
        <Button label="Как используются данные" variant="ghost" size="sm" href={`/s/${slug}/privacy`} />
      </HStack>
    </VStack>
  );
}
