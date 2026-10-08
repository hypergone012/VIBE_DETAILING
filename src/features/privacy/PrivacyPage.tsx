import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/features/tenant/TenantRoot';

/** Plain-language consent text shown next to the booking form. */
export function PrivacyPage() {
  const { data } = useTenant();
  const t = data.tenant;
  return (
    <main className="app-page" id="main" tabIndex={-1}>
      <VStack gap={4} paddingBlockStart={6}>
        <Heading level={1}>Как используются ваши данные</Heading>
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
    </main>
  );
}
