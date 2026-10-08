import { session } from './storage';

/**
 * One idempotency key per intended booking. Retrying the same choice (double tap,
 * lost response, page refresh) reuses the key, so the server returns the same
 * booking and the same access token instead of creating a copy.
 */
export function idempotencyKeyFor(scope: string, fingerprint: string): string {
  const storageKey = `idem:${scope}`;
  const saved = session.get<{ fingerprint: string; key: string } | null>(storageKey, null);
  if (saved && saved.fingerprint === fingerprint) return saved.key;
  const key = crypto.randomUUID();
  session.set(storageKey, { fingerprint, key });
  return key;
}

export function clearIdempotencyKey(scope: string): void {
  session.remove(`idem:${scope}`);
}
