import { forwardRef, useEffect, type DependencyList, type RefObject } from 'react';
import { createElement } from 'react';
import { prefersReducedMotion } from '@/lib/platform';

interface GlassOptions {
  /** Blur in px of what is seen through the glass (labels must stay legible). */
  frost?: number;
  tint?: string;
  /** Elements that change after the first snapshot (e.g. scroll reveals). */
  dynamic?: string;
  /** CSS selector of the element whose pixels the glass refracts. */
  snapshot?: string;
  zIndex?: number;
  resolution?: number;
  enabled?: boolean;
}

interface Lens {
  destroy?: () => void;
}

function canUseLiquid(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('glass') === 'off') return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 3) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean('gpu' in navigator || canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

let counter = 0;

/**
 * Real refractive glass (liquid-gl: WebGPU → WebGL) on top of the CSS glass
 * fallback. Loaded lazily; on any failure the element keeps the backdrop-filter
 * look. With reduced motion the glass stays static (no animated highlights).
 *
 * The lens target is a decorative pane (`paneRef`, aria-hidden) inside the
 * control: liquid-gl disables pointer events on its target and draws under it,
 * so labels and links stay real DOM above the glass — crisp and clickable.
 */
export function useLiquidGlass(
  containerRef: RefObject<HTMLElement | null>,
  paneRef: RefObject<HTMLElement | null>,
  options: GlassOptions,
  deps: DependencyList,
) {
  useEffect(() => {
    const container = containerRef.current;
    const el = paneRef.current;
    if (!container || !el || options.enabled === false || !canUseLiquid()) return;
    let cancelled = false;
    let lenses: Lens[] = [];
    const id = `glass-${++counter}`;
    el.dataset.liquidId = id;
    const reduced = prefersReducedMotion();

    const start = window.setTimeout(() => {
      import('liquid-gl')
        .then(({ default: liquidGL }) => {
          if (cancelled || !el.isConnected) return;
          const result = (liquidGL as unknown as (o: Record<string, unknown>) => Lens | Lens[] | undefined)({
            target: `[data-liquid-id="${id}"]`,
            snapshot: options.snapshot ?? 'body',
            resolution: options.resolution ?? 1.5,
            zIndex: options.zIndex,
            content: false,
            refraction: 0.012,
            bevelDepth: 0.06,
            bevelWidth: 0.22,
            frost: options.frost ?? 1.2,
            tint: options.tint ?? 'rgba(6, 8, 12, 0.22)',
            shadow: true,
            specular: !reduced,
            reveal: reduced ? 'none' : 'fade',
            on: {
              init: () => {
                if (!cancelled) container.dataset.glassEngine = 'liquid';
              },
            },
          });
          lenses = Array.isArray(result) ? result : result ? [result] : [];
          if (options.dynamic) {
            (liquidGL as unknown as { registerDynamic?: (s: string) => void }).registerDynamic?.(options.dynamic);
          }
        })
        .catch(() => {
          /* keep the CSS glass */
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      for (const lens of lenses) {
        try {
          lens.destroy?.();
        } catch {
          /* already gone */
        }
      }
      delete container.dataset.glassEngine;
      delete el.dataset.liquidId;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Decorative glass layer; the lens is drawn here, content sits above it. */
export const GlassPane = forwardRef<HTMLSpanElement>(function GlassPane(_props, ref) {
  return createElement('span', { ref, className: 'glass-pane', 'aria-hidden': true });
});
