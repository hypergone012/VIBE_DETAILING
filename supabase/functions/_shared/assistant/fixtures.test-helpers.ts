/** Test fixtures for the assistant unit tests (no network, no database). */
import type { LlmMessage, LlmPort, LlmResponse, LlmToolSpec, ServiceInfo, StudioInfo, ToolBackend } from './types.ts';

export const NOW = new Date('2026-10-09T07:00:00Z'); // Fri 9 Oct 2026, 10:00 in Moscow
export const TODAY = '2026-10-09';

export const SERVICES: ServiceInfo[] = [
  { id: 's-wash', name: 'Детейлинг-мойка', category: 'Мойка', description: null, price_minor: 350000, price_is_from: false, duration_minutes: 90, bookable: true },
  { id: 's-int', name: 'Химчистка салона', category: 'Салон', description: null, price_minor: 900000, price_is_from: true, duration_minutes: 240, bookable: true },
  { id: 's-pol', name: 'Полировка кузова', category: 'Кузов', description: null, price_minor: 1800000, price_is_from: true, duration_minutes: 360, bookable: true },
  { id: 's-cer', name: 'Керамическое покрытие', category: 'Защита', description: null, price_minor: 3500000, price_is_from: true, duration_minutes: 2880, bookable: true },
  { id: 's-ppf', name: 'Бронеплёнка: зона риска', category: 'Защита', description: null, price_minor: 4500000, price_is_from: true, duration_minutes: 1440, bookable: true },
  { id: 's-tire', name: 'Шиномонтаж 4 колеса', category: 'Колёса', description: null, price_minor: 240000, price_is_from: true, duration_minutes: 60, bookable: true },
];

export const STUDIO: StudioInfo = {
  name: 'Тестовая студия',
  timezone: 'Europe/Moscow',
  currency: 'RUB',
  status: 'preview',
  address: 'Город, улица, 1',
  address_note: 'Въезд со двора',
  map_url: 'https://maps.example/x',
  phone: '+74950000000',
  phone_display: '+7 495 000-00-00',
  messenger_url: null,
  hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens_at: '09:00', closes_at: '21:00' })),
  exceptions: [],
  rules: { min_lead_minutes: 120, horizon_days: 30, cancel_until_hours: 12 },
};

export interface Recorded {
  calls: string[];
}

export function fakeBackend(scope: 'client' | 'owner', rec: Recorded = { calls: [] }): ToolBackend & { rec: Recorded } {
  const backend: ToolBackend & { rec: Recorded } = {
    rec,
    studio: async () => STUDIO,
    services: async () => SERVICES,
    slots: async (serviceId, from) => {
      rec.calls.push(`slots:${serviceId}:${from}`);
      return [
        { date: TODAY, slots: [{ starts_at: '2026-10-09T09:00:00Z', time: '12:00', available: false }] },
        {
          date: '2026-10-10',
          slots: [
            { starts_at: '2026-10-10T07:00:00Z', time: '10:00', available: true },
            { starts_at: '2026-10-10T07:30:00Z', time: '10:30', available: true },
          ],
        },
      ];
    },
    myBooking: async () => null,
  };
  if (scope === 'owner') {
    backend.schedule = async (period) => {
      rec.calls.push(`schedule:${period}`);
      return {
        period: { key: period, from: '2026-10-10', to: '2026-10-10' },
        blocks: 0,
        bookings: [
          {
            starts_at: '2026-10-10T06:00:00Z',
            ends_at: '2026-10-10T07:30:00Z',
            service_name: 'Детейлинг-мойка',
            customer_name: 'Анна Лебедева',
            car_label: 'Skoda Octavia',
            resource_name: 'Бокс 1',
            status: 'confirmed',
          },
        ],
      };
    };
    backend.stats = async (period) => {
      rec.calls.push(`stats:${period}`);
      return {
        period: { key: period, from: '2026-10-05', to: '2026-10-11', timezone: 'Europe/Moscow' },
        currency: 'RUB',
        visits: 6,
        completed: 5,
        received_minor: 4150000,
        refunded_minor: 0,
        net_received_minor: 4150000,
        payments_count: 7,
        scheduled_count: 8,
        scheduled_value_minor: 13050000,
        new_bookings: 17,
        cancellations: 1,
        no_shows: 1,
      };
    };
  }
  return backend;
}

/** Scripted model: returns the queued responses in order and records every request. */
export function scriptedLlm(steps: (LlmResponse | Error | ((req: { messages: LlmMessage[]; tools?: LlmToolSpec[]; json?: boolean }) => LlmResponse))[]) {
  const requests: { messages: LlmMessage[]; tools?: LlmToolSpec[]; json?: boolean }[] = [];
  const port: LlmPort = {
    async complete(req) {
      requests.push(structuredClone(req));
      const step = steps.shift();
      if (!step) throw new Error('no more scripted responses');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(req) : step;
    },
  };
  return { port, requests };
}

export const text = (content: string, tokens = 50): LlmResponse => ({ content, tool_calls: [], total_tokens: tokens });
export const toolCall = (name: string, args: Record<string, unknown>, id = `call_${name}`): LlmResponse => ({
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  total_tokens: 40,
});
