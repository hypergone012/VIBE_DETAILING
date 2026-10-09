import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { PageFrame } from '@/components/PageFrame';
import { SectionHeader } from '@/components/SectionHeader';
import { useTenant } from '@/features/tenant/TenantRoot';

/** Plain-language consent text shown next to the booking form. */
export function PrivacyPage() {
  const { data } = useTenant();
  const t = data.tenant;
  return (
    <PageFrame width={680}>
      <VStack gap={5} paddingBlockStart={4}>
        <SectionHeader level={1} size="page" eyebrow={t.short_name} title="Как используются ваши данные" />
        <Text>
          При записи вы сообщаете имя, телефон и автомобиль. Эти данные получает только «{t.name}», чтобы подготовить бокс,
          связаться с вами при изменениях и выполнить работу.
        </Text>
        <Text>
          Регистрация не нужна. Доступ к вашей записи даёт секретная ссылка, сохранённая на этом устройстве; на сервере хранится
          только её отпечаток. Студия не видит, с какого устройства вы записывались.
        </Text>
        <Text>
          Напоминания приходят, только если вы сами включили их. Отозвать согласие и удалить данные можно, связавшись со студией
          {t.phone_display || t.phone ? ` по телефону ${t.phone_display ?? t.phone}` : ''}.
        </Text>
        <Text color="secondary" type="supporting">
          Помощник отвечает по данным студии и не получает ваши контакты.
        </Text>
      </VStack>
    </PageFrame>
  );
}
