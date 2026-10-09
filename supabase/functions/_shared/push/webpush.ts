/**
 * Web Push on WebCrypto only (runs in Deno Edge Runtime and Node 22):
 *  - message encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
 *  - VAPID authorization: RFC 8292 (ES256 JWT, `vapid t=…, k=…`)
 * Keys are base64url: public = uncompressed P-256 point (65 bytes), private = d (32 bytes).
 */

/** Bytes backed by a plain ArrayBuffer (what WebCrypto and fetch accept). */
export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const utf8 = (text: string): Bytes => new Uint8Array(enc.encode(text));
const subtle = () => globalThis.crypto.subtle;

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Bytes {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: contact of the sender (required by push services). */
  subject: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point');
  return subtle().importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** `Authorization` header value for one push service origin (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now(), ttlSeconds = 12 * 3600): Promise<string> {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + ttlSeconds, sub: keys.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  // WebCrypto ECDSA returns the raw r||s form that JWS ES256 expects.
  const signature = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Derives the content key and nonce shared by sender and receiver (RFC 8291 §3.3–3.4). */
export async function deriveKeys(params: {
  sharedSecret: Bytes;
  authSecret: Bytes;
  uaPublic: Bytes;
  asPublic: Bytes;
  salt: Bytes;
}): Promise<{ cek: Bytes; nonce: Bytes }> {
  const keyInfo = concat(utf8('WebPush: info\0'), params.uaPublic, params.asPublic);
  const ikm = await hkdf(params.authSecret, params.sharedSecret, keyInfo, 32);
  const cek = await hkdf(params.salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(params.salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  return { cek, nonce };
}

const RECORD_SIZE = 4096;

/** Encrypts one message for one subscription; returns the full aes128gcm body. */
export async function encryptPayload(subscription: PushSubscriptionKeys, payload: Bytes): Promise<Bytes> {
  const uaPublic = b64urlDecode(subscription.p256dh);
  const authSecret = b64urlDecode(subscription.auth);
  if (uaPublic.length !== 65) throw new Error('invalid p256dh');
  if (authSecret.length < 16) throw new Error('invalid auth secret');
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error('payload too large for one record');

  const ephemeral = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await subtle().exportKey('raw', ephemeral.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await deriveKeys({ sharedSecret, authSecret, uaPublic, asPublic, salt });
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Single (last) record: data || 0x02 delimiter.
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export type DeliveryOutcome = 'sent' | 'gone' | 'retry' | 'rejected';

export interface DeliveryResult {
  endpoint: string;
  outcome: DeliveryOutcome;
  status: number | null;
  error?: string;
}

/** Sends one encrypted push message and classifies the push service's answer. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  options: { vapid: VapidKeys; ttlSeconds: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; fetchImpl?: typeof fetch },
): Promise<DeliveryResult> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const body = await encryptPayload(subscription, utf8(JSON.stringify(payload)));
    const res = await doFetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, options.vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(Math.max(0, Math.round(options.ttlSeconds))),
        Urgency: options.urgency ?? 'normal',
        ...(options.topic ? { Topic: options.topic } : {}),
      },
      body,
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { endpoint: subscription.endpoint, outcome: 'sent', status: res.status };
    // 404/410: the subscription expired or was removed by the user — revoke it.
    if (res.status === 404 || res.status === 410) return { endpoint: subscription.endpoint, outcome: 'gone', status: res.status };
    if (res.status === 429 || res.status >= 500) return { endpoint: subscription.endpoint, outcome: 'retry', status: res.status };
    return { endpoint: subscription.endpoint, outcome: 'rejected', status: res.status, error: `HTTP ${res.status}` };
  } catch (error) {
    return { endpoint: subscription.endpoint, outcome: 'retry', status: null, error: error instanceof Error ? error.message : 'network' };
  }
}

/** Generates a VAPID key pair (scripts/push/vapid.ts). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d! };
}
