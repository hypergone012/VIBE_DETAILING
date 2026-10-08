import { Workbox } from 'workbox-window';

let workbox: Workbox | null = null;
let registration: ServiceWorkerRegistration | null = null;
const listeners = new Set<() => void>();
let updateWaiting = false;

/**
 * Registers the studio's own service worker (/s/{slug}/sw.js, scope /s/{slug}/).
 * Production builds only: the dev server has no per-studio worker.
 */
export async function registerStudioWorker(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return null;
  if (registration) return registration;
  workbox = new Workbox(`/s/${slug}/sw.js`, { scope: `/s/${slug}/` });
  workbox.addEventListener('waiting', () => {
    updateWaiting = true;
    listeners.forEach((l) => l());
  });
  try {
    registration = (await workbox.register()) ?? null;
  } catch (error) {
    console.warn('Service worker registration failed', error);
    registration = null;
  }
  return registration;
}

export function getStudioRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

export function onUpdateAvailable(cb: () => void): () => void {
  listeners.add(cb);
  if (updateWaiting) cb();
  return () => listeners.delete(cb);
}

export function applyUpdate(): void {
  if (!workbox) return;
  workbox.addEventListener('controlling', () => window.location.reload());
  workbox.messageSkipWaiting();
}

/** Owner logout: ask the worker to drop every runtime cache of this studio. */
export function clearPrivateCaches(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE' });
}
