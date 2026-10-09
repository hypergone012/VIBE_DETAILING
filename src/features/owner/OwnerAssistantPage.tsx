import { VStack } from '@astryxdesign/core/VStack';
import { PageFrame } from '@/components/PageFrame';
import { SectionHeader } from '@/components/SectionHeader';
import { AssistantChat } from '@/features/assistant/AssistantChat';
import { useOwner } from './OwnerContext';

const OWNER_EXAMPLES = ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'];

/** Owner assistant: reads schedule and stats through owner-only server tools; it never changes data. */
export function OwnerAssistantPage() {
  const { slug, session, accessToken } = useOwner();
  return (
    <PageFrame width={760} className="app-main--chat" fill>
      <VStack gap={4} paddingBlockStart={4} height="100%">
        <SectionHeader level={1} size="page" eyebrow={session.name} title="Помощник" />
        <AssistantChat
          scope="owner"
          slug={slug}
          accessToken={accessToken}
          examples={OWNER_EXAMPLES}
          intro="Отвечаю по вашим записям и платежам в часовом поясе студии. Ничего не меняю сам — записи и оплаты вы отмечаете в кабинете."
        />
      </VStack>
    </PageFrame>
  );
}
