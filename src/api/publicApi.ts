import { getPublicClient } from './client';
import { callRpc } from './rpc';
import {
  BookingEnvelopeSchema,
  CreateBookingSchema,
  OkSchema,
  PublicTenantSchema,
  RegisterPushSchema,
  SlotsSchema,
} from './schemas';

export interface CustomerInput {
  name: string;
  phone: string;
  car: string;
  plate?: string;
  comment?: string;
  consent: boolean;
}

export const publicApi = {
  tenant: (slug: string) => callRpc(getPublicClient(), 'get_public_tenant', { p_slug: slug }, PublicTenantSchema),

  slots: (slug: string, serviceId: string, from: string | null, days: number) =>
    callRpc(
      getPublicClient(),
      'get_available_slots',
      { p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days },
      SlotsSchema,
    ),

  /** Price, duration and studio are derived on the server; only the choice is sent. */
  createBooking: (slug: string, serviceId: string, startsAt: string, customer: CustomerInput, idempotencyKey: string) =>
    callRpc(
      getPublicClient(),
      'create_booking',
      {
        p_slug: slug,
        p_service_id: serviceId,
        p_starts_at: startsAt,
        p_customer: customer,
        p_idempotency_key: idempotencyKey,
      },
      CreateBookingSchema,
    ),

  booking: (slug: string, token: string) =>
    callRpc(getPublicClient(), 'get_booking', { p_slug: slug, p_token: token }, BookingEnvelopeSchema),

  cancel: (slug: string, token: string, reason: string | null) =>
    callRpc(getPublicClient(), 'cancel_booking', { p_slug: slug, p_token: token, p_reason: reason }, BookingEnvelopeSchema),

  registerPush: (slug: string, token: string, subscription: PushSubscriptionJSON & { user_agent?: string }) =>
    callRpc(
      getPublicClient(),
      'register_push',
      { p_slug: slug, p_token: token, p_subscription: subscription },
      RegisterPushSchema,
    ),

  unregisterPush: (slug: string, token: string, endpoint: string) =>
    callRpc(getPublicClient(), 'unregister_push', { p_slug: slug, p_token: token, p_endpoint: endpoint }, OkSchema),
};
