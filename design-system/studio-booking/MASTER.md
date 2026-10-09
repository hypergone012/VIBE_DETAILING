# Design system — Studio Booking (MASTER)

Source of truth for every screen of the client app and the owner cabinet.
Page files in `design-system/studio-booking/pages/` override this file.

How it was produced:
- `ui-ux-pro-max` (`.claude/skills/ui-ux-pro-max`):
  `search.py "appointment booking mobile app dark" --design-system --density 6 --variance 4 --motion 3`
  plus `"automotive premium dark technical" --domain typography` and `references/pro-rules.md`.
- Astryx 0.6.6 workflow (`.claude/skills/astryx`): `astryx build` → templates
  `centered-hero`, `product-detail` (sticky column), `login-card`, `dashboard`, `settings`, `detail-page`.
- The skill's generic light palette and raw CSS button/card snippets were **not** adopted:
  IMPLEMENTATION-PLAN.md fixes the palette (black, white, one studio accent) and Astryx
  owns component styling through theme tokens.

## Direction

"Studio at night": a dark, cinematic, photo-first app. Calm dense screens, one accent,
large confident type. Booking is a 3-step funnel (service → time → contacts) reachable
from every screen in one tap.

Pattern (skill): Hero-centric + Funnel (3-step conversion) — one dominant CTA in the hero,
progress shown inside the booking sheet, mini-CTA per step, final confirm.

## Color (theme tokens only — `src/theme/studioTheme.ts`)

| Role | Token | Value |
|------|-------|-------|
| Page | `--color-background-body` | `#000000` |
| Raised surface (cards, sheet) | `--color-background-surface` / `-card` | `#0E0F11` |
| Popover | `--color-background-popover` | `#151619` |
| Muted fill (chips, rows) | `--color-background-muted` | white 6% |
| Hairline | `--color-border` | white 12% |
| Text | `--color-text-primary` / `-secondary` | `#FFFFFF` / `#B6BAC1` (≥ 7:1 / ≥ 9:1 on black) |
| Accent (studio) | `--color-accent` | `tenant.accent_color` (default `#4690FF`) |
| On accent | `--color-on-accent` | black or white by WCAG ratio (`onAccentColor`) |

Rules: accent only for the primary action, the selected slot/tab and focus ring.
Status uses StatusDot/Token colors, never the accent. No raw hex in components.

## Typography

- Inter Variable, self-hosted (`@fontsource-variable/inter`, latin + latin-ext + cyrillic), body and heading.
- Scale: base 16, ratio 1.2 (Astryx geometric scale).
- Display (hero, page titles): weight 700, tracking −0.025em, `textWrap="balance"`.
- Headings: weight 650, tracking −0.015em.
- Eyebrow labels above sections: `Text type="supporting"` uppercase, tracking +0.08em, secondary color.
- Prices, times, counts: `hasTabularNumbers`.

## Layout

- Frame: Astryx `Layout` + `LayoutContent`, `contentWidth` 1120 (client) / 960 (cabinet).
- Phone: single column, 16px gutters (`--spacing-4`) plus safe areas; bottom glass tab bar,
  content reserves its height.
- ≥ 1024px: two columns — content left, sticky booking card right (product-detail template).
- Section rhythm: 40px between sections (`gap={10}`), 12px heading→content (`gap={3}`).
- Dense data = rows (`List`/`ListItem`, `Table`); `Card` only for standalone widgets.

## Components

- Primary CTA: Astryx `Button variant="primary" size="lg"`; hero CTA: liquid-glass button (liquid-gl)
  with crisp label above the lens, refracting only the hero photo.
- Works: `Carousel hasSnap` of 4:5 tiles + `Lightbox`.
- Hours: `MetadataList`/`List` rows, today highlighted.
- Booking: shadcn Drawer (Base UI branch) bottom sheet, 3 steps, `Stepper` progress.
- Status: `StatusDot` + text label; never color alone.

## Motion

- Scroll reveal: opacity 0→1, y 12px→0, 350ms, ease-out; disabled under `prefers-reduced-motion`.
- Press feedback ≤ 150ms (Astryx defaults); sheet uses Base UI drawer transitions.

## Pre-delivery checklist (from `references/pro-rules.md`)

- 375px phone, landscape, desktop 1440; reduced motion; 200% text.
- Touch targets ≥ 44px (coarse-pointer adaptation in theme).
- Icons: Phosphor only, one weight per level (regular in rows, bold in buttons), decorative icons `aria-hidden`.
- Safe areas respected by hero top bar, tab bar, sheet footer; nothing hidden behind the tab bar.
- Text contrast ≥ 4.5:1 (secondary text included); scrim measured on real photos.
- Every network screen has loading / error / empty / success.
