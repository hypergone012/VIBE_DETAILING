import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import { publicApi } from '@/api/publicApi';
import { ApiError, humanError } from '@/api/errors';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useTenant } from '@/features/tenant/TenantRoot';
import { contactStore, findBooking, saveBooking } from '@/lib/bookingVault';
import { formatDuration, formatInStudio, formatMoney, formatSlotLong } from '@/lib/format';
import { clearIdempotencyKey, idempotencyKeyFor } from '@/lib/idempotency';
import { session } from '@/lib/storage';
import { ReminderPanel } from '@/features/mybooking/ReminderPanel';
import { useBookingByToken } from '@/features/mybooking/useBookingByToken';
import { ContactStep, initialContact, validateContact, type ContactErrors, type ContactValues } from './ContactStep';
import { ServiceStep } from './ServiceStep';
import { slotsQueryKey, TimeStep } from './TimeStep';
import { useBookingRoute, type BookingStep } from './useBookingRoute';

const TITLES: Record<BookingStep, string> = {
  service: 'Выберите услугу',
  time: 'Дата и время',
  contact: 'Ваши контакты',
  confirm: 'Проверьте запись',
  done: 'Вы записаны',
};
const ORDER: BookingStep[] = ['service', 'time', 'contact', 'confirm'];

export function BookingSheet() {
  const { slug, data } = useTenant();
  const route = useBookingRoute();
  const queryClient = useQueryClient();
  const base = `/s/${slug}`;
  const tz = data.tenant.timezone;
  const service = data.services.find((s) => s.id === route.serviceId && s.bookable) ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const draftKey = `contact-draft:${slug}`;
  const [contact, setContact] = useState<ContactValues>(() => session.get<ContactValues | null>(draftKey, null) ?? initialContact());
  const [errors, setErrors] = useState<ContactErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Guard: a step deep-link without its prerequisites falls back to the right step.
  const step: BookingStep =
    route.step === 'done'
      ? 'done'
      : !service && route.step !== 'service'
        ? 'service'
        : (route.step === 'contact' || route.step === 'confirm') && !route.start
          ? 'time'
          : route.step;

  useEffect(() => {
    if (route.isOpen) headingRef.current?.focus({ preventScroll: true });
  }, [step, route.isOpen]);

  const updateContact = useCallback(
    (patch: Partial<ContactValues>) => {
      setContact((prev) => {
        const next = { ...prev, ...patch };
        session.set(draftKey, { ...next, consent: false });
        if (Object.keys(errors).length) setErrors(validateContact(next));
        return next;
      });
    },
    [draftKey, errors],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!service || !route.start) throw new ApiError('invalid_input', 'Выберите услугу и время');
      const fingerprint = [service.id, route.start, contact.phone.replace(/\D/g, ''), contact.name.trim().toLowerCase(), contact.car.trim().toLowerCase()].join('|');
      const key = idempotencyKeyFor(slug, fingerprint);
      return publicApi.createBooking(
        slug,
        service.id,
        route.start,
        {
          name: contact.name.trim(),
          phone: contact.phone.trim(),
          car: contact.car.trim(),
          plate: contact.plate.trim() || undefined,
          comment: contact.comment.trim() || undefined,
          consent: contact.consent === true,
        },
        key,
      );
    },
    onSuccess: (res) => {
      saveBooking(slug, {
        code: res.booking.code,
        token: res.access_token,
        startsAt: res.booking.starts_at,
        serviceName: res.booking.service_name,
      });
      if (contact.remember) {
        contactStore.set({ name: contact.name.trim(), phone: contact.phone.trim(), car: contact.car.trim(), plate: contact.plate.trim() });
      } else {
        contactStore.clear();
      }
      session.remove(draftKey);
      clearIdempotencyKey(slug);
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      route.go({ step: 'done', code: res.booking.code }, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.code === 'slot_taken' || error.code === 'slot_not_offered')) {
        clearIdempotencyKey(slug);
        setNotice(error.message);
        if (service) void queryClient.invalidateQueries({ queryKey: slotsQueryKey(slug, service.id) });
        route.go({ step: 'time', start: null });
      } else if (error instanceof ApiError && error.field) {
        setErrors({ [error.field]: error.message } as ContactErrors);
        route.go({ step: 'contact' });
      }
    },
  });

  const goNext = () => {
    if (step === 'contact') {
      const found = validateContact(contact);
      setErrors(found);
      if (Object.keys(found).length) return;
      route.go({ step: 'confirm' });
    } else if (step === 'confirm') {
      create.mutate();
    }
  };

  const stepIndex = ORDER.indexOf(step);
  const done = step === 'done' && route.code ? findBooking(slug, route.code) : undefined;

  return (
    <Drawer
      open={route.isOpen}
      onOpenChange={(open) => {
        if (!open) route.close();
      }}
      showSwipeHandle
      keyboardAware
    >
      <DrawerContent aria-describedby="booking-step-desc" data-testid="booking-sheet">
        <DrawerHeader className="booking-sheet__head">
          <HStack gap={2} vAlign="center">
            {stepIndex > 0 ? (
              <Button
                label="Назад"
                isIconOnly
                icon={<ArrowLeft weight="bold" />}
                variant="ghost"
                size="sm"
                onClick={() => window.history.back()}
              />
            ) : null}
            <VStack gap={0.5}>
              <DrawerTitle render={<h2 ref={headingRef} tabIndex={-1} />}>{TITLES[step]}</DrawerTitle>
              <DrawerDescription id="booking-step-desc">
                {step === 'done' ? data.tenant.name : `Запись в студию · шаг ${stepIndex + 1} из ${ORDER.length}`}
              </DrawerDescription>
            </VStack>
          </HStack>
        </DrawerHeader>

        <VStack gap={4} padding={4} isScrollable className="booking-sheet__body">
          {notice && step === 'time' ? <Banner status="warning" title={notice} isDismissable onDismiss={() => setNotice(null)} /> : null}

          {step === 'service' ? (
            <ServiceStep
              services={data.services}
              currency={data.tenant.currency}
              selectedId={route.serviceId}
              onSelect={(id) => route.go({ step: 'time', service: id, date: null, start: null })}
            />
          ) : null}

          {step === 'time' && service ? (
            <TimeStep
              slug={slug}
              service={service}
              timezone={tz}
              currency={data.tenant.currency}
              date={route.date}
              start={route.start}
              onPickDate={(date) => route.go({ date, start: null }, { replace: true })}
              onPickStart={(start) => {
                setNotice(null);
                route.go({ step: 'contact', start });
              }}
              onChangeService={() => route.go({ step: 'service' })}
            />
          ) : null}

          {step === 'contact' ? (
            <ContactStep values={contact} errors={errors} onChange={updateContact} privacyHref={`${base}/privacy`} />
          ) : null}

          {step === 'confirm' && service && route.start ? (
            <VStack gap={4}>
              <MetadataList columns="single">
                <MetadataListItem label="Услуга">{service.name}</MetadataListItem>
                <MetadataListItem label="Когда">{formatSlotLong(route.start, tz)}</MetadataListItem>
                <MetadataListItem label="Длительность">
                  {formatDuration(service.duration_minutes)}
                  {service.duration_minutes >= 1440
                    ? ` · выдача ${formatInStudio(new Date(new Date(route.start).getTime() + service.duration_minutes * 60_000), tz, 'd MMMM, HH:mm')}`
                    : ''}
                </MetadataListItem>
                <MetadataListItem label="Стоимость">
                  {formatMoney(service.price_minor, data.tenant.currency, service.price_is_from)}
                </MetadataListItem>
                <MetadataListItem label="Автомобиль">{[contact.car, contact.plate].filter(Boolean).join(', ')}</MetadataListItem>
                <MetadataListItem label="Контакт">{`${contact.name}, ${contact.phone}`}</MetadataListItem>
                {data.tenant.address ? <MetadataListItem label="Адрес">{data.tenant.address}</MetadataListItem> : null}
              </MetadataList>
              {service.price_is_from ? (
                <Text type="supporting" color="secondary">
                  Итоговую цену студия назовёт после осмотра. Оплата — на месте.
                </Text>
              ) : (
                <Text type="supporting" color="secondary">
                  Оплата — на месте после работы.
                </Text>
              )}
              {create.isError && !(create.error instanceof ApiError && (create.error.code === 'slot_taken' || create.error.field)) ? (
                <Banner status="error" title="Запись не создана" description={humanError(create.error)} />
              ) : null}
            </VStack>
          ) : null}

          {step === 'done' ? (
            done ? (
              <DoneStep code={done.code} token={done.token} />
            ) : (
              <Banner status="info" title="Запись сохранена" description="Откройте раздел «Моя запись», чтобы увидеть детали." />
            )
          ) : null}
        </VStack>

        {step === 'contact' || step === 'confirm' ? (
          <DrawerFooter>
            <Button
              label={step === 'confirm' ? 'Подтвердить запись' : 'Продолжить'}
              variant="primary"
              size="lg"
              width="100%"
              isLoading={create.isPending}
              onClick={goNext}
            />
          </DrawerFooter>
        ) : null}
        {step === 'done' ? (
          <DrawerFooter>
            <Button label="Готово" variant="secondary" size="lg" width="100%" onClick={route.close} />
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function DoneStep({ code, token }: { code: string; token: string }) {
  const { slug, data } = useTenant();
  const query = useBookingByToken(slug, token);
  const b = query.data;
  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center">
        <CheckCircle size={40} weight="fill" color="var(--color-success)" aria-hidden />
        <VStack gap={0.5}>
          <Text weight="semibold">Код записи {code}</Text>
          <Text color="secondary" type="supporting">
            Запись сохранена на этом устройстве в разделе «Моя запись».
          </Text>
        </VStack>
      </HStack>
      {b ? (
        <>
          <MetadataList columns="single">
            <MetadataListItem label="Услуга">{b.service_name}</MetadataListItem>
            <MetadataListItem label="Когда">{formatSlotLong(b.starts_at, data.tenant.timezone)}</MetadataListItem>
            <MetadataListItem label="Бокс">{b.resource_name}</MetadataListItem>
          </MetadataList>
          {b.is_demo ? <Banner status="info" title="Это образец" description="Запись тестовая: студия ещё не запущена." /> : null}
          <ReminderPanel booking={b} token={token} slug={slug} />
          <Button label="Открыть мою запись" variant="ghost" href={`/s/${slug}/my/${code}`} />
        </>
      ) : null}
      {query.isError ? <Banner status="warning" title="Не удалось обновить детали" description={humanError(query.error)} /> : null}
    </VStack>
  );
}

