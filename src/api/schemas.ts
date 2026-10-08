/**
 * Response contracts of the Postgres RPCs (see supabase/migrations). Every network
 * response is parsed with these schemas before it reaches the UI.
 */
import { z } from 'zod';

const nullableString = z.string().nullable();

export const InfoCardSchema = z.object({
  title: z.string(),
  text: z.string(),
  icon: z.string(),
});

export const ServiceSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: nullableString,
  category: nullableString,
  price_minor: z.number(),
  price_is_from: z.boolean(),
  duration_minutes: z.number(),
  bookable: z.boolean(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const PublicTenantSchema = z.object({
  ok: z.literal(true),
  tenant: z.object({
    slug: z.string(),
    status: z.enum(['preview', 'live']),
    name: z.string(),
    short_name: z.string(),
    tagline: nullableString,
    description: nullableString,
    address: nullableString,
    address_note: nullableString,
    map_url: nullableString,
    geo: z.object({ lat: z.number(), lng: z.number() }).nullable(),
    phone: nullableString,
    phone_display: nullableString,
    messenger_url: nullableString,
    accent_color: z.string(),
    logo_path: nullableString,
    hero_path: nullableString,
    hero_alt: nullableString,
    info_cards: z.array(InfoCardSchema),
    timezone: z.string(),
    currency: z.string(),
    locale: z.string(),
    rules: z.object({
      slot_step_minutes: z.number(),
      min_lead_minutes: z.number(),
      horizon_days: z.number(),
      cancel_until_hours: z.number(),
    }),
  }),
  services: z.array(ServiceSchema),
  hours: z.array(z.object({ weekday: z.number(), opens_at: z.string(), closes_at: z.string() })),
  exceptions: z.array(
    z.object({
      date: z.string(),
      is_closed: z.boolean(),
      opens_at: nullableString,
      closes_at: nullableString,
      note: nullableString,
    }),
  ),
  photos: z.array(z.object({ id: z.string(), path: z.string(), caption: nullableString })),
});
export type PublicTenant = z.infer<typeof PublicTenantSchema>;

export const SlotsSchema = z.object({
  ok: z.literal(true),
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  horizon_end: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      slots: z.array(z.object({ starts_at: z.string(), time: z.string(), available: z.boolean() })),
    }),
  ),
});
export type Slots = z.infer<typeof SlotsSchema>;

export const PublicBookingSchema = z.object({
  code: z.string(),
  status: z.enum(['confirmed', 'arrived', 'done', 'cancelled', 'no_show']),
  service_name: z.string(),
  price_minor: z.number(),
  price_is_from: z.boolean(),
  currency: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  duration_minutes: z.number(),
  resource_name: z.string(),
  customer_name: z.string(),
  customer_phone_masked: nullableString,
  car_label: z.string(),
  car_plate: nullableString,
  is_demo: z.boolean(),
  created_at: z.string(),
  cancelled_at: nullableString,
  cancel_deadline: z.string(),
  can_cancel: z.boolean(),
  studio: z.object({
    slug: z.string(),
    name: z.string(),
    phone: nullableString,
    phone_display: nullableString,
    address: nullableString,
    map_url: nullableString,
    timezone: z.string(),
    cancel_until_hours: z.number(),
  }),
});
export type PublicBooking = z.infer<typeof PublicBookingSchema>;

export const CreateBookingSchema = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  access_token: z.string(),
  booking: PublicBookingSchema,
});

export const BookingEnvelopeSchema = z.object({ ok: z.literal(true), booking: PublicBookingSchema });

export const RegisterPushSchema = z.object({
  ok: z.literal(true),
  state: z.enum(['scheduled', 'too_late', 'preview']),
  reminder_at: z.string().nullable(),
});

export const OkSchema = z.object({ ok: z.literal(true) });
