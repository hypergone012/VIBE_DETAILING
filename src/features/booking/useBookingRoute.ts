import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

export type BookingStep = 'service' | 'time' | 'contact' | 'confirm' | 'done';
const STEPS: BookingStep[] = ['service', 'time', 'contact', 'confirm', 'done'];
const PARAMS = ['book', 'step', 'service', 'date', 'start', 'code'] as const;

interface SheetState {
  sheetDepth?: number;
}

/**
 * The booking sheet lives in the URL (?book=1&step=…): every step is a history
 * entry, so the system Back button walks back through steps and finally closes the
 * sheet, and a reload keeps the choice. Personal data never goes into the URL.
 */
export function useBookingRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const depth = (location.state as SheetState | null)?.sheetDepth ?? 0;

  const state = useMemo(() => {
    const raw = params.get('step') as BookingStep | null;
    return {
      isOpen: params.get('book') === '1',
      step: raw && STEPS.includes(raw) ? raw : ('service' as BookingStep),
      serviceId: params.get('service'),
      date: params.get('date'),
      start: params.get('start'),
      code: params.get('code'),
    };
  }, [params]);

  const go = useCallback(
    (patch: Partial<Record<(typeof PARAMS)[number], string | null>>, opts: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(params);
      next.set('book', '1');
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      navigate(
        { pathname: location.pathname, search: `?${next.toString()}` },
        { replace: opts.replace, state: { sheetDepth: opts.replace ? depth : depth + 1 } satisfies SheetState },
      );
    },
    [params, navigate, location.pathname, depth],
  );

  const open = useCallback(
    (serviceId?: string | null) => {
      const next = new URLSearchParams(params);
      for (const p of PARAMS) next.delete(p);
      next.set('book', '1');
      next.set('step', serviceId ? 'time' : 'service');
      if (serviceId) next.set('service', serviceId);
      navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { state: { sheetDepth: 1 } satisfies SheetState });
    },
    [params, navigate, location.pathname],
  );

  /** Closes the sheet and pops its history entries so Back does not reopen it. */
  const close = useCallback(() => {
    if (depth > 0 && window.history.length > depth) {
      navigate(-depth);
      return;
    }
    const next = new URLSearchParams(params);
    for (const p of PARAMS) next.delete(p);
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true, state: null });
  }, [depth, params, navigate, location.pathname]);

  return { ...state, go, open, close };
}
