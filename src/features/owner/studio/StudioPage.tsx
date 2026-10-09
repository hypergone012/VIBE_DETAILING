import type { ComponentType } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  ArrowLeft,
  CalendarX,
  CaretRight,
  Cards,
  Clock,
  Garage,
  Images,
  ListChecks,
  SignOut,
  SlidersHorizontal,
  Storefront,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { PageFrame, useIsWide } from '@/components/PageFrame';
import { ErrorState, LoadingRows } from '@/components/QueryState';
import { SectionHeader } from '@/components/SectionHeader';
import { useOwner } from '../OwnerContext';
import { CardsSection } from './CardsSection';
import { ExceptionsSection, HoursSection } from './HoursSection';
import { MediaSection, PhotosSection } from './MediaSection';
import { ProfileSection, RulesSection } from './ProfileSection';
import { ResourcesSection } from './ResourcesSection';
import { ServicesSection } from './ServicesSection';
import { useSettings } from './useSettings';

interface Section {
  key: string;
  title: string;
  description: string;
  icon: PhosphorIcon;
  Component: ComponentType;
}

export const SECTIONS: Section[] = [
  { key: 'profile', title: 'Студия и контакты', description: 'Название, описание, адрес, телефон, цвет', icon: Storefront, Component: ProfileSection },
  { key: 'services', title: 'Услуги и цены', description: 'Прайс, длительность, подготовка бокса', icon: ListChecks, Component: ServicesSection },
  { key: 'boxes', title: 'Боксы', description: 'Посты, подъёмники и мастера', icon: Garage, Component: ResourcesSection },
  { key: 'hours', title: 'Часы работы', description: 'Когда принимаете машины', icon: Clock, Component: HoursSection },
  { key: 'days', title: 'Выходные и особые дни', description: 'Праздники, сокращённые дни', icon: CalendarX, Component: ExceptionsSection },
  { key: 'media', title: 'Логотип и обложка', description: 'Главное фото и значок', icon: Images, Component: MediaSection },
  { key: 'photos', title: 'Фото работ', description: 'Добавить, заменить, подписать', icon: Images, Component: PhotosSection },
  { key: 'cards', title: 'Три карточки', description: 'Преимущества на главной', icon: Cards, Component: CardsSection },
  { key: 'rules', title: 'Правила записи', description: 'Шаг сетки, запас времени, отмена', icon: SlidersHorizontal, Component: RulesSection },
];

/** Studio settings (Astryx settings template): side nav on wide screens, a section list on phones. */
export function StudioPage() {
  const wide = useIsWide();
  const settings = useSettings();

  return (
    <PageFrame width={1120}>
      <VStack gap={6} paddingBlockStart={4}>
        {settings.isPending ? <LoadingRows rows={5} label="Загружаем настройки" /> : null}
        {settings.isError ? <ErrorState error={settings.error} onRetry={() => void settings.refetch()} title="Настройки не загрузились" /> : null}
        {settings.data ? (
          <Routes>
            <Route index element={wide ? <Navigate to="profile" replace /> : <SectionIndex />} />
            <Route path=":section" element={wide ? <WideLayout /> : <SectionScreen />} />
            <Route path="*" element={<Navigate to="." replace />} />
          </Routes>
        ) : null}
      </VStack>
    </PageFrame>
  );
}

function SectionIndex() {
  const { base, session, signOut } = useOwner();
  return (
    <VStack gap={6}>
      <SectionHeader level={1} size="page" eyebrow={session.name} title="Студия" description="Всё, что видят клиенты на странице записи." />
      <List hasDividers density="spacious" edgeCompensation="inline">
        {SECTIONS.map((s) => (
          <ListItem
            key={s.key}
            href={`${base}/studio/${s.key}`}
            startContent={<s.icon size={22} aria-hidden className="icon-accent" />}
            label={s.title}
            description={s.description}
            endContent={<CaretRight size={16} aria-hidden className="icon-secondary" />}
          />
        ))}
      </List>
      <AccountBlock email={session.email} signOut={signOut} />
    </VStack>
  );
}

function AccountBlock({ email, signOut }: { email: string | null; signOut: () => Promise<void> }) {
  const { slug } = useOwner();
  return (
    <VStack gap={3}>
      <Divider />
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <VStack gap={0.5}>
          <Text type="supporting" color="secondary">
            Вы вошли как
          </Text>
          <Text weight="semibold">{email ?? 'владелец'}</Text>
        </VStack>
        <HStack gap={2} wrap="wrap">
          <Button label="Страница записи" variant="ghost" icon={<ArrowSquareOut weight="bold" />} href={`/s/${slug}/`} />
          <Button label="Выйти" variant="secondary" icon={<SignOut weight="bold" />} onClick={() => void signOut()} />
        </HStack>
      </HStack>
    </VStack>
  );
}

function SectionScreen() {
  const { section } = useParams();
  const { base } = useOwner();
  const found = SECTIONS.find((s) => s.key === section);
  if (!found) return <Navigate to={`${base}/studio`} replace />;
  return (
    <VStack gap={6}>
      <HStack>
        <Button label="Студия" variant="ghost" size="sm" icon={<ArrowLeft weight="bold" />} href={`${base}/studio`} />
      </HStack>
      <SectionHeader level={1} size="page" title={found.title} description={found.description} />
      <found.Component />
    </VStack>
  );
}

function WideLayout() {
  const { section } = useParams();
  const { base, session, signOut } = useOwner();
  const found = SECTIONS.find((s) => s.key === section);
  if (!found) return <Navigate to={`${base}/studio/profile`} replace />;
  return (
    <Grid columns={4} columnGap={10} align="start">
      <VStack gap={4} className="sticky-aside grid-cell">
        <SectionHeader level={1} eyebrow={session.name} title="Студия" />
        <List density="balanced">
          {SECTIONS.map((s) => (
            <ListItem key={s.key} href={`${base}/studio/${s.key}`} label={s.title} isSelected={s.key === section} />
          ))}
        </List>
        <AccountBlock email={session.email} signOut={signOut} />
      </VStack>
      <GridSpan columns={3} className="grid-cell">
        <VStack gap={6}>
          <SectionHeader level={2} size="page" title={found.title} description={found.description} />
          <found.Component />
        </VStack>
      </GridSpan>
    </Grid>
  );
}
