import { useSearchParams } from 'react-router';
import { VStack } from '@astryxdesign/core/VStack';
import { PageFrame } from '@/components/PageFrame';
import { SectionHeader } from '@/components/SectionHeader';
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
    <PageFrame width={760} className="app-main--chat" fill>
      <VStack gap={4} paddingBlockStart={4} height="100%">
        <SectionHeader level={1} size="page" eyebrow={data.tenant.short_name} title="Помощник" />
        <AssistantChat
          scope="client"
          slug={slug}
          examples={examples}
          initialQuestion={params.get('q')}
          bookingToken={latest?.token}
          intro={`Отвечаю по данным «${data.tenant.name}»: услуги, цены, свободное время и как добраться. Записать вас могу через кнопку «Записаться».`}
        />
      </VStack>
    </PageFrame>
  );
}
