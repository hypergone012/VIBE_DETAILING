import { local } from './storage';

/**
 * Bookings made on this device. The access token is the client's only key to
 * their booking (no account), so it is kept locally per studio. Nothing else
 * about the booking is stored; details are always fetched fresh by token.
 */
export interface VaultEntry {
  code: string;
  token: string;
  startsAt: string;
  serviceName: string;
  savedAt: string;
}

const key = (slug: string) => `bookings:${slug}`;

export function listBookings(slug: string): VaultEntry[] {
  const entries = local.get<VaultEntry[]>(key(slug), []);
  return Array.isArray(entries) ? entries.filter((e) => e && typeof e.token === 'string') : [];
}

export function saveBooking(slug: string, entry: Omit<VaultEntry, 'savedAt'>): void {
  const rest = listBookings(slug).filter((e) => e.code !== entry.code);
  local.set(key(slug), [{ ...entry, savedAt: new Date().toISOString() }, ...rest].slice(0, 20));
}

export function forgetBooking(slug: string, code: string): void {
  local.set(
    key(slug),
    listBookings(slug).filter((e) => e.code !== code),
  );
}

export function findBooking(slug: string, code: string): VaultEntry | undefined {
  return listBookings(slug).find((e) => e.code === code);
}

/** Contact details the client chose to remember on this device. */
export interface RememberedContact {
  name: string;
  phone: string;
  car: string;
  plate: string;
}

export const contactStore = {
  get: (): RememberedContact | null => local.get<RememberedContact | null>('contact', null),
  set: (c: RememberedContact) => local.set('contact', c),
  clear: () => local.remove('contact'),
};
