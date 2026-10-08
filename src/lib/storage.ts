/** localStorage/sessionStorage that never throws (private mode, blocked storage, quota). */
function safe(kind: 'local' | 'session') {
  const store = () => {
    try {
      return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = store()?.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown): void {
      try {
        store()?.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable: feature degrades to in-memory */
      }
    },
    remove(key: string): void {
      try {
        store()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    keys(): string[] {
      try {
        const s = store();
        return s ? Array.from({ length: s.length }, (_, i) => s.key(i) ?? '').filter(Boolean) : [];
      } catch {
        return [];
      }
    },
  };
}

export const local = safe('local');
export const session = safe('session');
