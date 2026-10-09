/**
 * Shared, dependency-free types of the studio assistant. Imported by the Deno
 * Edge Function and by the Node unit tests alike (no runtime-specific APIs).
 */
export type Scope = 'client' | 'owner';

/** Period keys resolved in SQL (private.resolve_period) — the same keys the cabinet UI uses. */
export const PERIOD_KEYS = [
  'today',
  'tomorrow',
  'yesterday',
  'this_week',
  'last_week',
  'next_week',
  'this_month',
  'last_month',
  'last_7_days',
  'next_7_days',
  'last_30_days',
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StudioInfo {
  name: string;
  timezone: string;
  currency: string;
  status: 'preview' | 'live';
  address: string | null;
  address_note: string | null;
  map_url: string | null;
  phone: string | null;
  phone_display: string | null;
  messenger_url: string | null;
  hours: { weekday: number; opens_at: string; closes_at: string }[];
  exceptions: { date: string; is_closed: boolean; opens_at: string | null; closes_at: string | null; note: string | null }[];
  rules: { min_lead_minutes: number; horizon_days: number; cancel_until_hours: number };
}

export interface ServiceInfo {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price_minor: number;
  price_is_from: boolean;
  duration_minutes: number;
  bookable: boolean;
}

export interface SlotDay {
  date: string;
  slots: { starts_at: string; time: string; available: boolean }[];
}

export interface MyBookingInfo {
  code: string;
  status: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  resource_name: string;
  can_cancel: boolean;
  cancel_deadline: string;
}

export interface ScheduleItem {
  starts_at: string;
  ends_at: string;
  service_name: string;
  customer_name: string;
  car_label: string;
  resource_name: string;
  status: string;
}

export interface ScheduleInfo {
  period: { key: string; from: string; to: string };
  bookings: ScheduleItem[];
  blocks: number;
}

export interface StatsInfo {
  period: { key: string; from: string; to: string; timezone: string };
  currency: string;
  visits: number;
  completed: number;
  received_minor: number;
  refunded_minor: number;
  net_received_minor: number;
  payments_count: number;
  scheduled_count: number;
  scheduled_value_minor: number;
  new_bookings: number;
  cancellations: number;
  no_shows: number;
}

/**
 * Data access bound to ONE studio by the server (slug from the request, owner
 * methods only with a verified owner session). Tools never pass a tenant id or SQL.
 */
export interface ToolBackend {
  studio(): Promise<StudioInfo>;
  services(): Promise<ServiceInfo[]>;
  slots(serviceId: string, from: string | null, days: number): Promise<SlotDay[]>;
  myBooking?: () => Promise<MyBookingInfo | null>;
  schedule?: (period: PeriodKey) => Promise<ScheduleInfo>;
  stats?: (period: PeriodKey) => Promise<StatsInfo>;
}

/** OpenAI-compatible chat message (subset). */
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmResponse {
  content: string | null;
  tool_calls: LlmToolCall[];
  total_tokens: number;
}

/** The model behind LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (adapter in the Edge Function). */
export interface LlmPort {
  complete(request: { messages: LlmMessage[]; tools?: LlmToolSpec[]; json?: boolean }): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly status: number | null;
  /** The provider rejected tool calling (→ JSON-intent fallback). */
  readonly toolsUnsupported: boolean;
  constructor(message: string, status: number | null, toolsUnsupported: boolean) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.toolsUnsupported = toolsUnsupported;
  }
}

export interface ToolRecord {
  name: string;
  label: string;
  ok: boolean;
}

export interface AssistantReply {
  reply: string;
  intent: string;
  degraded: boolean;
  mode: 'tools' | 'json' | 'template';
  tool_calls: ToolRecord[];
  used_tokens: number;
}
