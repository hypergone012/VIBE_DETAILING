import { publicApi } from '@/api/publicApi';
import { env } from '@/lib/env';
import { isIos, isStandalone, supportsPush } from '@/lib/platform';
import { local } from '@/lib/storage';
import { getStudioRegistration, registerStudioWorker } from './registerServiceWorker';

/**
 * Honest reminder states. We never claim a reminder is on unless the server has
 * stored the subscription and scheduled the job.
 */
export type ReminderState =
  | { kind: 'unsupported' }
  | { kind: 'needs_install' }
  | { kind: 'not_configured' }
  | { kind: 'denied' }
  | { kind: 'available' }
  | { kind: 'scheduled'; at: string | null }
  | { kind: 'preview' }
  | { kind: 'too_late' }
  | { kind: 'error'; message: string };

const storeKey = (slug: string, code: string) => `reminder:${slug}:${code}`;

export function initialReminderState(slug: string, code: string): ReminderState {
  const saved = local.get<ReminderState | null>(storeKey(slug, code), null);
  if (saved && (saved.kind === 'scheduled' || saved.kind === 'preview' || saved.kind === 'too_late')) return saved;
  if (!supportsPush()) return isIos() && !isStandalone() ? { kind: 'needs_install' } : { kind: 'unsupported' };
  if (isIos() && !isStandalone()) return { kind: 'needs_install' };
  if (!env.VITE_VAPID_PUBLIC_KEY) return { kind: 'not_configured' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  return { kind: 'available' };
}

function base64UrlToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enableReminder(slug: string, code: string, token: string): Promise<ReminderState> {
  const initial = initialReminderState(slug, code);
  if (initial.kind !== 'available') return initial;
  try {
    const registration = getStudioRegistration() ?? (await registerStudioWorker(slug));
    if (!registration) return { kind: 'error', message: 'Приложение ещё не готово к уведомлениям. Обновите страницу и попробуйте снова.' };
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { kind: 'denied' };
    const ready = await navigator.serviceWorker.ready;
    const subscription =
      (await ready.pushManager.getSubscription()) ??
      (await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(env.VITE_VAPID_PUBLIC_KEY),
      }));
    const res = await publicApi.registerPush(slug, token, {
      ...subscription.toJSON(),
      user_agent: navigator.userAgent.slice(0, 300),
    });
    const state: ReminderState =
      res.state === 'scheduled' ? { kind: 'scheduled', at: res.reminder_at } : { kind: res.state };
    local.set(storeKey(slug, code), state);
    return state;
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Не удалось включить напоминание' };
  }
}
