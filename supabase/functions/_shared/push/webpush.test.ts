import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';
import { jobOutcome, reminderPayload, safeEqual } from './dispatch.ts';
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, sendWebPush, vapidAuthorization } from './webpush.ts';

/** A browser-side subscription: P-256 key pair + 16-byte auth secret. */
function fakeBrowserSubscription(endpoint = 'https://push.example.test/send/abc') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: { endpoint, p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) },
  };
}

describe('RFC 8291 message encryption', () => {
  it('is decrypted by the reference http_ece implementation (aes128gcm)', async () => {
    const browser = fakeBrowserSubscription();
    const message = JSON.stringify({ title: 'Напоминание', body: 'Завтра в 10:00 — Детейлинг-мойка' });
    const body = await encryptPayload(browser.subscription, new TextEncoder().encode(message));

    // Header: salt(16) | rs(4) = 4096 | idlen = 65 | keyid = sender public key
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);

    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: browser.auth });
    expect(plain.toString('utf8')).toBe(message);
  });

  it('uses a fresh key and salt for every message', async () => {
    const { subscription } = fakeBrowserSubscription();
    const a = await encryptPayload(subscription, new TextEncoder().encode('x'));
    const b = await encryptPayload(subscription, new TextEncoder().encode('x'));
    expect(Buffer.from(a.slice(0, 16)).equals(Buffer.from(b.slice(0, 16)))).toBe(false);
    expect(Buffer.from(a.slice(21, 86)).equals(Buffer.from(b.slice(21, 86)))).toBe(false);
  });

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload({ endpoint: 'https://x', p256dh: 'AAAA', auth: 'AAAA' }, new Uint8Array([1]))).rejects.toThrow();
  });
});

describe('RFC 8292 VAPID', () => {
  it('signs an ES256 JWT for the push service origin that verifies with the public key', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.com' };
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz', keys, Date.UTC(2026, 9, 9));
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split('.');
    expect(JSON.parse(Buffer.from(b64urlDecode(h!)).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(b64urlDecode(c!)).toString());
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:owner@example.com' });
    expect(claims.exp - Date.UTC(2026, 9, 9) / 1000).toBeLessThanOrEqual(24 * 3600);

    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('delivery classification', () => {
  const vapidPromise = generateVapidKeys().then((k) => ({ ...k, subject: 'mailto:test@example.com' }));
  const send = async (status: number | 'throw') => {
    const { subscription } = fakeBrowserSubscription();
    const fetchImpl = (async () => {
      if (status === 'throw') throw new TypeError('network down');
      return new Response(null, { status });
    }) as typeof fetch;
    return sendWebPush(subscription, { title: 't' }, { vapid: await vapidPromise, ttlSeconds: 3600, fetchImpl });
  };

  it.each([
    [201, 'sent'],
    [410, 'gone'],
    [404, 'gone'],
    [429, 'retry'],
    [503, 'retry'],
    [400, 'rejected'],
    ['throw', 'retry'],
  ] as const)('%s → %s', async (status, outcome) => {
    expect((await send(status)).outcome).toBe(outcome);
  });

  it('turns per-subscription results into one job outcome', () => {
    const r = (outcome: 'sent' | 'gone' | 'retry' | 'rejected') => ({ endpoint: 'e', outcome, status: null });
    expect(jobOutcome([r('gone'), r('sent')]).outcome).toBe('sent');
    expect(jobOutcome([r('gone'), r('retry')]).outcome).toBe('retry');
    expect(jobOutcome([r('gone'), r('gone')]).outcome).toBe('no_subscribers');
    expect(jobOutcome([]).outcome).toBe('no_subscribers');
    expect(jobOutcome([r('rejected')]).outcome).toBe('failed');
  });
});

describe('reminder text', () => {
  it('says «Завтра в …» in the studio timezone and links to the booking', () => {
    const job = {
      job_id: 'j',
      kind: 'reminder_24h' as const,
      attempts: 1,
      dedupe_key: 'k',
      booking: { id: 'b', code: 'R9LYB3', service_name: 'Детейлинг-мойка', starts_at: '2026-10-10T07:00:00Z', status: 'confirmed' },
      tenant: { slug: 'studio', name: 'Студия', short_name: 'Студия', timezone: 'Asia/Yekaterinburg', address: 'Улица, 1' },
      subscriptions: [],
    };
    const p = reminderPayload(job, new Date('2026-10-09T08:00:00Z'));
    expect(p).toEqual({
      title: 'Напоминание: Студия',
      body: 'Завтра в 12:00 — Детейлинг-мойка. Улица, 1. Код записи R9LYB3.',
      url: '/s/studio/my/R9LYB3',
      tag: 'reminder-R9LYB3',
    });
  });

  it('compares the cron secret in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});
