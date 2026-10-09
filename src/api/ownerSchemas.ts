/**
 * Response contracts of the owner RPCs (supabase/migrations/*_owner_api.sql,
 * *_stats.sql). Parsed with Zod before reaching the cabinet UI.
 */
import { z } from 'zod';

const str = z.string();
const nstr = z.string().nullable();

export const BookingStatusSchema = z.enum(['confirmed', 'arrived', 'done', 'cancelled', 'no_show']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const OwnerSessionSchema = z.object({
  tenant_id: str,
  slug: str,
  name: str,
  status: z.enum(['preview', 'live', 'archived']),
  timezone: str,
  currency: str,
  accent_color: str,
  logo_path: nstr,
  role: str,
  email: nstr,
});
export type OwnerSession = z.infer<typeof OwnerSessionSchema>;

export const OwnerBookingSchema = z.object({
  id: str,
  code: str,
  status: BookingStatusSchema,
  source: str,
  is_demo: z.boolean(),
  service_id: str,
  service_name: str,
  resource_id: str,
  resource_name: str,
  starts_at: str,
  ends_at: str,
  occupied_until: nstr,
  duration_minutes: z.number(),
  buffer_minutes: z.number(),
  price_minor: z.number(),
  price_is_from: z.boolean(),
  currency: str,
  customer_name: str,
  customer_phone: str,
  car_label: str,
  car_plate: nstr,
  customer_comment: nstr,
  owner_note: nstr,
  arrived_at: nstr,
  done_at: nstr,
  no_show_at: nstr,
  cancelled_at: nstr,
  cancelled_by: nstr,
  cancel_reason: nstr,
  reschedule_count: z.number(),
  created_at: str,
  paid_minor: z.number(),
  refunded_minor: z.number(),
});
export type OwnerBooking = z.infer<typeof OwnerBookingSchema>;

const PeriodSchema = z.object({
  key: str,
  from: str,
  to: str,
  starts_at: str,
  ends_at: str,
});

export const ResourceSchema = z.object({ id: str, name: str, kind: str, is_active: z.boolean() });

export const BlockSchema = z.object({
  id: str,
  resource_id: str,
  starts_at: str,
  ends_at: str,
  note: nstr,
});
export type Block = z.infer<typeof BlockSchema>;

export const ScheduleSchema = z.object({
  period: PeriodSchema,
  timezone: str,
  resources: z.array(ResourceSchema),
  bookings: z.array(OwnerBookingSchema),
  blocks: z.array(BlockSchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const PaymentSchema = z.object({
  id: str,
  kind: z.enum(['payment', 'refund']),
  amount_minor: z.number(),
  method: z.enum(['cash', 'card', 'transfer', 'other']),
  paid_at: str,
  note: nstr,
});
export type Payment = z.infer<typeof PaymentSchema>;

export const BookingEventSchema = z.object({
  kind: str,
  payload: z.record(z.string(), z.unknown()).nullable(),
  actor: nstr,
  created_at: str,
});
export type BookingEvent = z.infer<typeof BookingEventSchema>;

export const BookingDetailSchema = z.object({
  booking: OwnerBookingSchema,
  payments: z.array(PaymentSchema),
  events: z.array(BookingEventSchema),
});
export type BookingDetail = z.infer<typeof BookingDetailSchema>;

export const OwnerSlotsSchema = z.object({
  timezone: str,
  days: z.array(
    z.object({
      date: str,
      slots: z.array(
        z.object({ starts_at: str, time: str, available: z.boolean(), free_resources: z.number() }),
      ),
    }),
  ),
});
export type OwnerSlots = z.infer<typeof OwnerSlotsSchema>;

export const BookingResultSchema = z.object({ booking: OwnerBookingSchema }).passthrough();
export const CreateResultSchema = z.object({
  replayed: z.boolean(),
  booking: OwnerBookingSchema,
  access_token: str,
});
export const ChangeResultSchema = z.object({ changed: z.boolean(), booking: OwnerBookingSchema });
export const PaymentResultSchema = z.object({ replayed: z.boolean(), payment_id: str, booking: OwnerBookingSchema });
export const BlockResultSchema = z.object({ id: str, replayed: z.boolean() });
export const ReleasedSchema = z.object({ released: z.boolean() });
export const AccessLinkSchema = z.object({ access_token: str });

export const StatsSchema = z.object({
  period: PeriodSchema.extend({ timezone: str }),
  currency: str,
  visits: z.number(),
  completed: z.number(),
  received_minor: z.number(),
  refunded_minor: z.number(),
  net_received_minor: z.number(),
  payments_count: z.number(),
  bookings_starting: z.number(),
  scheduled_count: z.number(),
  scheduled_value_minor: z.number(),
  new_bookings: z.number(),
  cancellations: z.number(),
  no_shows: z.number(),
  by_day: z
    .array(z.object({ date: str, visits: z.number(), completed: z.number(), net_received_minor: z.number() }))
    .nullable(),
});
export type Stats = z.infer<typeof StatsSchema>;

const InfoCardSchema = z.object({ title: str, text: str, icon: str });
export type InfoCard = z.infer<typeof InfoCardSchema>;

export const SettingsTenantSchema = z.object({
  id: str,
  slug: str,
  status: z.enum(['preview', 'live', 'archived']),
  timezone: str,
  currency: str,
  name: str,
  short_name: str,
  tagline: nstr,
  description: nstr,
  address: nstr,
  address_note: nstr,
  map_url: nstr,
  phone: nstr,
  phone_display: nstr,
  messenger_url: nstr,
  accent_color: str,
  logo_path: nstr,
  hero_path: nstr,
  hero_alt: nstr,
  info_cards: z.array(InfoCardSchema),
  slot_step_minutes: z.number(),
  min_lead_minutes: z.number(),
  horizon_days: z.number(),
  cancel_until_hours: z.number(),
  owner_overrides: z.array(str),
});
export type SettingsTenant = z.infer<typeof SettingsTenantSchema>;

export const SettingsServiceSchema = z.object({
  id: str,
  key: str,
  name: str,
  description: nstr,
  category: nstr,
  price_minor: z.number(),
  price_is_from: z.boolean(),
  duration_minutes: z.number(),
  buffer_minutes: z.number(),
  is_active: z.boolean(),
  sort: z.number(),
  origin: str,
  resource_ids: z.array(str),
});
export type SettingsService = z.infer<typeof SettingsServiceSchema>;

export const SettingsResourceSchema = z.object({
  id: str,
  key: str,
  name: str,
  kind: str,
  is_active: z.boolean(),
  sort: z.number(),
  origin: str,
});
export type SettingsResource = z.infer<typeof SettingsResourceSchema>;

export const HoursRowSchema = z.object({ weekday: z.number(), opens_at: str, closes_at: str });
export type HoursRow = z.infer<typeof HoursRowSchema>;

export const ExceptionSchema = z.object({
  id: str,
  date: str,
  is_closed: z.boolean(),
  opens_at: nstr,
  closes_at: nstr,
  note: nstr,
  origin: str,
});
export type ScheduleException = z.infer<typeof ExceptionSchema>;

export const SettingsPhotoSchema = z.object({ id: str, path: str, caption: nstr, sort: z.number(), origin: str });
export type SettingsPhoto = z.infer<typeof SettingsPhotoSchema>;

export const SettingsSchema = z.object({
  tenant: SettingsTenantSchema,
  resources: z.array(SettingsResourceSchema),
  services: z.array(SettingsServiceSchema),
  hours: z.array(HoursRowSchema),
  exceptions: z.array(ExceptionSchema),
  photos: z.array(SettingsPhotoSchema),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const UpdatedSchema = z.object({ updated: z.array(str) });
export const MediaResultSchema = z.object({ kind: str, path: str });
export const InfoCardsResultSchema = z.object({ info_cards: z.array(InfoCardSchema) });
export const ResourceResultSchema = SettingsResourceSchema.extend({ future_bookings: z.number() });
export const HoursResultSchema = z.object({ hours: z.array(HoursRowSchema) });
export const ExceptionResultSchema = z.object({ date: str, bookings_on_date: z.number() });
export const DeletedSchema = z.object({ deleted: z.boolean() });
export const PhotoResultSchema = z.object({ id: str, path: str.optional() });
export const RemovedSchema = z.object({ removed: z.boolean() });
