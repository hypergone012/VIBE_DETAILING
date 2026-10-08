import { useEffect, useState } from 'react';
import { isIos, isStandalone } from '@/lib/platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

/** Must run before React mounts so the early event is not lost. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    subscribers.forEach((s) => s());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    subscribers.forEach((s) => s());
  });
}

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((n) => n + 1);
    subscribers.add(s);
    return () => {
      subscribers.delete(s);
    };
  }, []);
  const standalone = isStandalone();
  return {
    installed: standalone,
    canPrompt: !standalone && deferred !== null,
    iosManual: !standalone && isIos(),
    async prompt(): Promise<boolean> {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      subscribers.forEach((sub) => sub());
      return choice.outcome === 'accepted';
    },
  };
}
