import { defineTheme, type DefinedTheme } from '@astryxdesign/core/theme';
import { phosphorIconRegistry } from './icons';

const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK_ACCENT = '#4690FF';
const cache = new Map<string, DefinedTheme>();

/**
 * Runtime Astryx theme for one studio. The accent is the only per-tenant
 * color and comes from the tenant record (business.json → DB). It is passed
 * through `color.accent`, so Astryx derives --color-on-accent, muted and text
 * variants with its contrast model instead of us hand-writing them.
 *
 * The app is dark-only (<Theme mode="dark">); light values exist only because
 * tokens are [light, dark] tuples.
 */
export function studioTheme(accent: string | null | undefined): DefinedTheme {
  const seed = accent && HEX.test(accent) ? accent.toUpperCase() : FALLBACK_ACCENT;
  const cached = cache.get(seed);
  if (cached) return cached;

  const theme = defineTheme({
    name: `studio-${seed.slice(1).toLowerCase()}`,
    color: { accent: [seed, seed], neutralStyle: 'neutral', contrast: 'standard' },
    typography: {
      // 16px base keeps body copy readable on phones (Astryx default is 14px).
      scale: { base: 16, ratio: 1.2 },
      body: {
        family: 'system-ui',
        fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      },
    },
    radius: { base: 4, multiplier: 1.25 },
    tokens: {
      '--color-background-body': ['#F4F5F7', '#000000'],
      '--color-background-surface': ['#FFFFFF', '#0E0F11'],
      '--color-background-card': ['#FFFFFF', '#0E0F11'],
      '--color-background-popover': ['#FFFFFF', '#141518'],
      '--color-background-muted': ['#0536590C', '#FFFFFF0F'],
      '--color-text-primary': ['#0A1317', '#FFFFFF'],
      '--color-text-secondary': ['#4E606F', '#B6BAC1'],
      '--color-icon-primary': ['#0A1317', '#FFFFFF'],
      '--color-icon-secondary': ['#4E606F', '#B6BAC1'],
      '--color-border': ['#05365919', '#FFFFFF1F'],
    },
    adaptations: {
      rules: [
        {
          // Touch targets: 44px controls on coarse pointers (phones).
          when: { pointer: 'coarse' },
          value: {
            tokens: {
              '--size-element-sm': '36px',
              '--size-element-md': '44px',
              '--size-element-lg': '48px',
            },
          },
        },
      ],
    },
    icons: phosphorIconRegistry,
  });

  cache.set(seed, theme);
  return theme;
}
