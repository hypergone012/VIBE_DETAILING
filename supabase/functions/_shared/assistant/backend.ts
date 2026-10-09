/**
 * ToolBackend over PostgREST RPCs (plain fetch: runs in Deno and Node).
 * Client scope: public RPCs only (anon key) + the booking token from this device.
 * Owner scope: owner_* RPCs called WITH the owner's JWT, so the database checks
 * membership in this studio for every read.
 */
import type { MyBookingInfo, PeriodKey, ScheduleInfo, ServiceInfo, SlotDay, StatsInfo, StudioInfo, ToolBackend } from './types.ts';

export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export class RpcError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** POST /rest/v1/rpc/<fn>. Public envelopes {ok:false} and PostgREST errors become RpcError. */
export function postgrestRpc(options: { url: string; apikey: string; bearer?: string; headers?: Record<string, string> }): RpcFn {
  return async (fn, args) => {
    const res = await fetch(`${options.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: options.apikey,
        // New sb_publishable_/sb_secret_ keys are not JWTs: the gateway derives the
        // role from `apikey`. Only real JWTs (owner session, legacy keys) go as Bearer.
        ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : options.apikey.startsWith('ey') ? { Authorization: `Bearer ${options.apikey}` } : {}),
        ...options.headers,
      },
      body: JSON.stringify(args),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const code = typeof body?.message === 'string' && /^[a-z_]+$/.test(body.message) ? body.message : 'rpc_failed';
      throw new RpcError(code, typeof body?.hint === 'string' ? body.hint : `RPC ${fn} failed`, res.status);
    }
    if (body && body.ok === false) throw new RpcError(String(body.error ?? 'error'), String(body.message ?? 'Ошибка'), 200);
    return body;
  };
}

interface PublicTenantPayload {
  tenant: {
    name: string;
    status: 'preview' | 'live';
    timezone: string;
    currency: string;
    address: string | null;
    address_note: string | null;
    map_url: string | null;
    phone: string | null;
    phone_display: string | null;
    messenger_url: string | null;
    rules: StudioInfo['rules'];
  };
  services: (Omit<ServiceInfo, 'bookable'> & { bookable: boolean })[];
  hours: StudioInfo['hours'];
  exceptions: StudioInfo['exceptions'];
}

function tenantLoader(slug: string, rpcPublic: RpcFn) {
  let cached: Promise<PublicTenantPayload> | null = null;
  return () => (cached ??= rpcPublic('get_public_tenant', { p_slug: slug }) as Promise<PublicTenantPayload>);
}

function studioOf(p: PublicTenantPayload): StudioInfo {
  const t = p.tenant;
  return {
    name: t.name,
    status: t.status,
    timezone: t.timezone,
    currency: t.currency,
    address: t.address,
    address_note: t.address_note,
    map_url: t.map_url,
    phone: t.phone,
    phone_display: t.phone_display,
    messenger_url: t.messenger_url,
    hours: p.hours,
    exceptions: p.exceptions,
    rules: t.rules,
  };
}

const servicesOf = (p: PublicTenantPayload): ServiceInfo[] =>
  p.services.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category ?? null,
    description: s.description ?? null,
    price_minor: s.price_minor,
    price_is_from: s.price_is_from,
    duration_minutes: s.duration_minutes,
    bookable: s.bookable,
  }));

export function clientBackend(slug: string, rpcPublic: RpcFn, bookingToken?: string | null): ToolBackend {
  const tenant = tenantLoader(slug, rpcPublic);
  return {
    studio: async () => studioOf(await tenant()),
    services: async () => servicesOf(await tenant()),
    slots: async (serviceId, from, days) => {
      const r = (await rpcPublic('get_available_slots', { p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days })) as {
        days: SlotDay[];
      };
      return r.days;
    },
    myBooking: async () => {
      if (!bookingToken) return null;
      try {
        const r = (await rpcPublic('get_booking', { p_slug: slug, p_token: bookingToken })) as { booking: MyBookingInfo };
        return r.booking;
      } catch {
        return null;
      }
    },
  };
}

export function ownerBackend(slug: string, rpcPublic: RpcFn, rpcOwner: RpcFn): ToolBackend {
  const tenant = tenantLoader(slug, rpcPublic);
  return {
    studio: async () => studioOf(await tenant()),
    services: async () => servicesOf(await tenant()),
    slots: async (serviceId, from, days) =>
      ((await rpcOwner('owner_slots', { p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days })) as { days: SlotDay[] }).days,
    schedule: async (period: PeriodKey) => {
      const r = (await rpcOwner('owner_schedule', { p_slug: slug, p_period: period })) as {
        period: ScheduleInfo['period'];
        bookings: ScheduleInfo['bookings'];
        blocks: unknown[];
      };
      return { period: r.period, bookings: r.bookings, blocks: r.blocks.length };
    },
    stats: async (period: PeriodKey) => (await rpcOwner('owner_stats', { p_slug: slug, p_period: period })) as StatsInfo,
  };
}
