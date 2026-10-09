import { getOwnerClient } from './ownerClient';
import { ApiError } from './errors';
import { callRpc } from './rpc';
import {
  AccessLinkSchema,
  BlockResultSchema,
  BookingDetailSchema,
  BookingResultSchema,
  ChangeResultSchema,
  CreateResultSchema,
  DeletedSchema,
  ExceptionResultSchema,
  HoursResultSchema,
  InfoCardsResultSchema,
  MediaResultSchema,
  OwnerSessionSchema,
  OwnerSlotsSchema,
  PaymentResultSchema,
  PhotoResultSchema,
  ReleasedSchema,
  RemovedSchema,
  ResourceResultSchema,
  ScheduleSchema,
  SettingsSchema,
  SettingsServiceSchema,
  StatsSchema,
  UpdatedSchema,
  type BookingStatus,
  type HoursRow,
  type InfoCard,
} from './ownerSchemas';

/** Period keys resolved on the server in the studio timezone (same as the assistant). */
export type PeriodKey =
  | 'today'
  | 'tomorrow'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'next_week'
  | 'this_month'
  | 'last_month'
  | 'last_7_days'
  | 'next_7_days'
  | 'last_30_days'
  | 'custom';

export interface OwnerCustomer {
  name: string;
  phone: string;
  car: string;
  plate?: string;
  comment?: string;
  owner_note?: string;
}

export interface ServiceInput {
  id?: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price_minor: number;
  price_is_from: boolean;
  duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  resource_ids: string[];
}

export interface ResourceInput {
  id?: string;
  name: string;
  kind: string;
  is_active: boolean;
}

export interface ExceptionInput {
  date: string;
  is_closed: boolean;
  opens_at?: string | null;
  closes_at?: string | null;
  note?: string | null;
}

/**
 * Owner cabinet API. Every call is an RPC that resolves the studio by slug and
 * checks membership of the signed-in user on the server; the client never
 * sends tenant_id, prices or durations.
 */
export function ownerApi(slug: string) {
  const db = getOwnerClient(slug);
  const rpc = <S extends Parameters<typeof callRpc>[3]>(fn: string, args: Record<string, unknown>, schema: S) =>
    callRpc(db, fn, { p_slug: slug, ...args }, schema);

  return {
    session: () => rpc('owner_session', {}, OwnerSessionSchema),
    schedule: (period: PeriodKey, from?: string, to?: string) =>
      rpc('owner_schedule', { p_period: period, p_from: from ?? null, p_to: to ?? null }, ScheduleSchema),
    booking: (id: string) => rpc('owner_booking', { p_booking_id: id }, BookingDetailSchema),
    slots: (serviceId: string, from: string, days: number) =>
      rpc('owner_slots', { p_service_id: serviceId, p_from: from, p_days: days }, OwnerSlotsSchema),
    createBooking: (serviceId: string, startsAt: string, customer: OwnerCustomer, resourceId: string | null, idempotencyKey: string) =>
      rpc(
        'owner_create_booking',
        {
          p_service_id: serviceId,
          p_starts_at: startsAt,
          p_customer: customer,
          p_resource_id: resourceId,
          p_idempotency_key: idempotencyKey,
        },
        CreateResultSchema,
      ),
    reschedule: (id: string, startsAt: string, resourceId: string | null) =>
      rpc('owner_reschedule_booking', { p_booking_id: id, p_starts_at: startsAt, p_resource_id: resourceId }, ChangeResultSchema),
    cancel: (id: string, reason: string | null) =>
      rpc('owner_cancel_booking', { p_booking_id: id, p_reason: reason }, ChangeResultSchema),
    setStatus: (id: string, status: BookingStatus) =>
      rpc('owner_set_status', { p_booking_id: id, p_status: status }, ChangeResultSchema),
    updateNote: (id: string, note: string) =>
      rpc('owner_update_booking_note', { p_booking_id: id, p_note: note }, BookingResultSchema),
    addPayment: (id: string, kind: 'payment' | 'refund', amountMinor: number, method: string, note: string | null, idempotencyKey: string) =>
      rpc(
        'owner_add_payment',
        {
          p_booking_id: id,
          p_kind: kind,
          p_amount_minor: amountMinor,
          p_method: method,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        },
        PaymentResultSchema,
      ),
    createBlock: (resourceId: string, startsAt: string, endsAt: string, note: string | null) =>
      rpc('owner_create_block', { p_resource_id: resourceId, p_starts_at: startsAt, p_ends_at: endsAt, p_note: note }, BlockResultSchema),
    releaseBlock: (blockId: string) => rpc('owner_release_block', { p_block_id: blockId }, ReleasedSchema),
    issueLink: (id: string) => rpc('owner_issue_booking_link', { p_booking_id: id }, AccessLinkSchema),
    stats: (period: PeriodKey, from?: string, to?: string) =>
      rpc('owner_stats', { p_period: period, p_from: from ?? null, p_to: to ?? null }, StatsSchema),

    settings: () => rpc('owner_settings', {}, SettingsSchema),
    updateProfile: (patch: Record<string, unknown>) => rpc('owner_update_profile', { p_patch: patch }, UpdatedSchema),
    setMedia: (kind: 'logo' | 'hero', path: string) => rpc('owner_set_media', { p_kind: kind, p_path: path }, MediaResultSchema),
    setInfoCards: (cards: InfoCard[]) => rpc('owner_set_info_cards', { p_cards: cards }, InfoCardsResultSchema),
    upsertService: (service: ServiceInput) => rpc('owner_upsert_service', { p_service: service }, SettingsServiceSchema),
    upsertResource: (resource: ResourceInput) => rpc('owner_upsert_resource', { p_resource: resource }, ResourceResultSchema),
    setHours: (hours: HoursRow[]) => rpc('owner_set_working_hours', { p_hours: hours }, HoursResultSchema),
    upsertException: (exception: ExceptionInput) => rpc('owner_upsert_exception', { p_exception: exception }, ExceptionResultSchema),
    deleteException: (date: string) => rpc('owner_delete_exception', { p_date: date }, DeletedSchema),
    addPhoto: (path: string, caption: string | null) => rpc('owner_add_photo', { p_path: path, p_caption: caption }, PhotoResultSchema),
    replacePhoto: (id: string, path: string) => rpc('owner_replace_photo', { p_photo_id: id, p_path: path }, PhotoResultSchema),
    setPhotoCaption: (id: string, caption: string | null) =>
      rpc('owner_set_photo_caption', { p_photo_id: id, p_caption: caption }, PhotoResultSchema),
    removePhoto: (id: string) => rpc('owner_remove_photo', { p_photo_id: id }, RemovedSchema),

    /** Uploads an owner photo to tenant-media/<tenant_id>/owner/<random>.<ext>. */
    uploadMedia: async (tenantId: string, file: File): Promise<string> => {
      const prepared = await prepareImage(file);
      const path = `${tenantId}/owner/${crypto.randomUUID()}.${prepared.ext}`;
      const { error } = await db.storage.from('tenant-media').upload(path, prepared.blob, {
        contentType: prepared.type,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw new ApiError('upload_failed', 'Не удалось загрузить фото. Проверьте интернет и попробуйте ещё раз.');
      return path;
    },
  };
}

export type OwnerApi = ReturnType<typeof ownerApi>;

const MAX_EDGE = 2400;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Downscales large phone photos to at most 2400px on the long edge and encodes
 * WebP in the browser, so uploads stay fast on mobile data and under the 8 MiB
 * bucket limit. Falls back to the original file when the browser cannot encode.
 */
async function prepareImage(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ApiError('invalid_media', 'Подойдут фото в JPEG, PNG, WebP или AVIF.');
  }
  const original = { blob: file as Blob, type: file.type, ext: file.type.split('/')[1]!.replace('jpeg', 'jpg') };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (blob && blob.type === 'image/webp' && blob.size < file.size * 1.2) return { blob, type: 'image/webp', ext: 'webp' };
  } catch {
    // Older browsers: keep the original file.
  }
  if (file.size > 8 * 1024 * 1024) throw new ApiError('invalid_media', 'Фото больше 8 МБ — уменьшите его и попробуйте снова.');
  return original;
}
