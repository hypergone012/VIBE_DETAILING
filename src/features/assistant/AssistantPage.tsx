import { useSearchParams } from 'react-router';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/features/tenant/TenantRoot';
import { assistantExamples } from '@/features/home/HomePage';
import { listBookings } from '@/lib/bookingVault';
import { useNow } from '@/lib/useNow';
import { AssistantChat } from './AssistantChat';

export function AssistantPage() {
  const { slug, data } = useTenant();
  const [params] = useSearchParams();
  const examples = assistantExamples(data.services.filter((s) => s.bookable).map((s) => s.name));
  const now = useNow();
  const latest = listBookings(slug).find((b) => new Date(b.startsAt).getTime() > now);

  return (
    <main className="app-page app-page--chat" id="main" tabIndex={-1}>
      <VStack gap={3} paddingBlockStart={6} height="100%">
        <Heading level={1}>Помощник</Heading>
        <AssistantChat
          scope="client"
          slug={slug}
          examples={examples}
          initialQuestion={params.get('q')}
          bookingToken={latest?.token}
          intro={`Отвечаю по данным «${data.tenant.name}»: услуги, цены, свободное время и как добраться. Записать вас могу через кнопку «Записаться».`}
        />
      </VStack>
    </main>
  );
}
