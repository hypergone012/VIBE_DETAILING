import { useCallback, useState } from 'react';
import { z } from 'zod';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { contactStore } from '@/lib/bookingVault';

export const ContactSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя — минимум 2 буквы').max(80, 'Слишком длинное имя'),
  phone: z
    .string()
    .trim()
    .refine((v) => {
      const d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 15;
    }, 'Номер телефона: 10–11 цифр, например +7 900 123-45-67'),
  car: z.string().trim().min(2, 'Укажите марку и модель').max(80, 'Слишком длинно'),
  plate: z.string().trim().max(16, 'До 16 символов'),
  comment: z.string().trim().max(500, 'До 500 символов'),
  consent: z.literal(true, { error: 'Нужно согласие на обработку данных для записи' }),
  remember: z.boolean(),
});
export type ContactValues = z.input<typeof ContactSchema>;
export type ContactErrors = Partial<Record<keyof ContactValues, string>>;

export function initialContact(): ContactValues {
  const saved = contactStore.get();
  return {
    name: saved?.name ?? '',
    phone: saved?.phone ?? '',
    car: saved?.car ?? '',
    plate: saved?.plate ?? '',
    comment: '',
    consent: false as unknown as true,
    remember: Boolean(saved),
  };
}

export function validateContact(values: ContactValues): ContactErrors {
  const r = ContactSchema.safeParse(values);
  if (r.success) return {};
  const errors: ContactErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as keyof ContactValues;
    errors[key] ??= issue.message;
  }
  return errors;
}

const status = (message?: string) => (message ? { type: 'error' as const, message } : undefined);

export function ContactStep({
  values,
  errors,
  onChange,
  privacyHref,
}: {
  values: ContactValues;
  errors: ContactErrors;
  onChange: (patch: Partial<ContactValues>) => void;
  privacyHref: string;
}) {
  const [touched, setTouched] = useState(false);
  // Astryx TextInput supports text/password/email only; ask phones for the dial pad.
  const phoneRef = useCallback((el: HTMLInputElement | null) => {
    if (el && el.tagName === 'INPUT') {
      el.setAttribute('inputmode', 'tel');
      el.setAttribute('type', 'tel');
    }
  }, []);

  return (
    <VStack gap={4} onBlur={() => setTouched(true)}>
      <TextInput
        label="Имя"
        value={values.name}
        onChange={(name) => onChange({ name })}
        autoComplete="name"
        isRequired
        status={status(errors.name)}
        htmlName="name"
      />
      <TextInput
        ref={phoneRef}
        label="Телефон"
        value={values.phone}
        onChange={(phone) => onChange({ phone })}
        autoComplete="tel"
        placeholder="+7 900 123-45-67"
        description="Студия позвонит, если что-то изменится"
        isRequired
        status={status(errors.phone)}
        htmlName="phone"
      />
      <TextInput
        label="Автомобиль"
        value={values.car}
        onChange={(car) => onChange({ car })}
        placeholder="Марка, модель, цвет"
        isRequired
        status={status(errors.car)}
        htmlName="car"
      />
      <TextInput
        label="Госномер"
        value={values.plate}
        onChange={(plate) => onChange({ plate })}
        isOptional
        status={status(errors.plate)}
        htmlName="plate"
      />
      <TextArea
        label="Комментарий"
        value={values.comment}
        onChange={(comment) => onChange({ comment })}
        rows={2}
        maxLength={500}
        isOptional
        status={status(errors.comment)}
      />
      <CheckboxInput
        label="Запомнить мои данные на этом устройстве"
        value={values.remember}
        onChange={(remember) => onChange({ remember })}
      />
      <VStack gap={1}>
        <CheckboxInput
          label="Согласен на обработку персональных данных для записи"
          value={values.consent === true}
          onChange={(consent) => onChange({ consent: consent as true })}
          status={touched || errors.consent ? status(errors.consent) : undefined}
        />
        <Text type="supporting" color="secondary">
          Имя, телефон и автомобиль видит только студия. <Link href={privacyHref}>Как используются данные</Link>
        </Text>
      </VStack>
    </VStack>
  );
}
