import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatToolCalls,
} from '@astryxdesign/core/Chat';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { askAssistant, type AssistantReply, type ChatTurn } from '@/api/assistantApi';
import { humanError } from '@/api/errors';

interface Message extends ChatTurn {
  id: string;
  meta?: Pick<AssistantReply, 'tool_calls' | 'degraded' | 'mode'>;
  failed?: boolean;
}

/**
 * Chat with the studio assistant. The answer is grounded in server tools (slots,
 * services, schedule, stats); the list of tools used is shown under each answer
 * so people can see what the reply is based on.
 */
export function AssistantChat({
  scope,
  slug,
  examples,
  initialQuestion,
  accessToken,
  bookingToken,
  intro,
}: {
  scope: 'client' | 'owner';
  slug: string;
  examples: string[];
  initialQuestion?: string | null;
  accessToken?: string;
  bookingToken?: string;
  intro: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const asked = useRef(false);

  const ask = useMutation({
    mutationFn: (history: Message[]) =>
      askAssistant({
        scope,
        slug,
        accessToken,
        bookingToken,
        messages: history.filter((m) => !m.failed).map(({ role, content }) => ({ role, content })),
      }),
    onSuccess: (reply) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply.reply,
          meta: { tool_calls: reply.tool_calls, degraded: reply.degraded, mode: reply.mode },
        },
      ]);
    },
  });

  const send = (text: string) => {
    const content = text.trim().slice(0, 600);
    if (!content || ask.isPending) return;
    const next = [...messages, { id: crypto.randomUUID(), role: 'user' as const, content }];
    setMessages(next);
    setDraft('');
    ask.mutate(next);
  };

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const lastDegraded = [...messages].reverse().find((m) => m.meta)?.meta?.degraded;

  return (
    <ChatLayout
      density="balanced"
      composer={
        <VStack gap={2}>
          {ask.isError ? (
            <Banner status="error" title="Помощник не ответил" description={humanError(ask.error)} />
          ) : null}
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            placeholder={scope === 'owner' ? 'Например: что у меня завтра?' : 'Спросите про услуги, цены или время'}
            isDisabled={ask.isPending}
            elevation="low"
          />
        </VStack>
      }
    >
      <ChatMessageList
        isStreaming={ask.isPending}
        align="top"
        emptyState={
          <VStack gap={4} paddingBlockStart={2}>
            <Text color="secondary" textWrap="pretty">
              {intro}
            </Text>
            <HStack gap={2} wrap="wrap">
              {examples.map((q) => (
                <Token key={q} label={q} size="lg" onClick={() => send(q)} />
              ))}
            </HStack>
          </VStack>
        }
      >
        {messages.length || ask.isPending ? (
          <>
            {messages.map((m) =>
              m.role === 'user' ? (
                <ChatMessage key={m.id} sender="user">
                  <ChatMessageBubble>{m.content}</ChatMessageBubble>
                </ChatMessage>
              ) : (
                <ChatMessage key={m.id} sender="assistant">
                  {m.meta?.tool_calls.length ? (
                    <ChatToolCalls
                      label={`Проверено по данным студии: ${m.meta.tool_calls.length}`}
                      calls={m.meta.tool_calls.map((c, i) => ({
                        key: `${m.id}-${i}`,
                        name: c.label,
                        status: c.ok ? 'complete' : 'error',
                      }))}
                    />
                  ) : null}
                  <ChatMessageBubble>{m.content}</ChatMessageBubble>
                </ChatMessage>
              ),
            )}
            {ask.isPending ? (
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">Смотрю данные студии…</ChatMessageBubble>
              </ChatMessage>
            ) : null}
          </>
        ) : null}
      </ChatMessageList>
      {lastDegraded ? (
        <Text type="supporting" color="secondary">
          Языковая модель сейчас недоступна — ответ собран по шаблону из данных студии.
        </Text>
      ) : null}
    </ChatLayout>
  );
}
