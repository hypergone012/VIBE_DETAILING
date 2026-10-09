---
name: astryx
description: "Astryx design system (Meta, @astryxdesign/core 0.6.6) workflow for this repo. Use before creating or changing ANY screen, component, layout or theme token in src/: scaffold pages from Astryx templates (astryx build → astryx template → astryx component), use Astryx components for layout instead of raw divs, and put colors/fonts in the studio theme. Also covers the shadcn Drawer that coexists with Astryx and the Astryx MCP server."
---

# Astryx workflow (this repo)

Packaged from the agent docs that `astryx init --agent all` generates for the installed
version (upstream: https://github.com/facebook/astryx, MIT). The CLI answers offline from
`node_modules`, so prefer it; the MCP server (`.mcp.json` → `astryx`) gives the same docs
where the network allows `astryx.atmeta.com`.

Run every command as `pnpm exec astryx <cmd>` (or `pnpm astryx -- <cmd>`).

## 1. Start every page from a template

1. `pnpm exec astryx build "<idea>"` — names the page template to start from, two
   alternatives, and the blocks/components for what it lacks.
2. `pnpm exec astryx template <name> --type page tmp-tpl/<name>` — scaffold (relative path
   only), then port its frame into `src/features/...`. Keep its `Layout`/`LayoutContent`
   frame, gaps and padding; replace data, copy and sections.
3. `pnpm exec astryx template <Block>` for a missing part, `pnpm exec astryx component <Name>`
   for props **before** using a component or a prop you have not checked.

Changing an existing page: keep its frame, add blocks/components inside its sections.

Templates already mapped in this app (see `design-system/studio-booking/MASTER.md`):
`centered-hero` + `product-detail` (client home: hero + sticky booking column),
`login-card` (owner login), `dashboard` (owner stats), `settings` (studio settings),
`detail-page` (owner booking detail), `shell-nav` (owner navigation).

## 2. Rules

- No raw `<div>`/`<span>` for layout — `Layout`, `VStack`, `HStack`, `Grid`, `Center`,
  `Section`, `Card`, `AspectRatio` do layout and spacing.
- Dense data = rows (`List`/`ListItem`, `Table`); `Card` only for standalone widgets.
  Status = `StatusDot`/`Token`; `Badge` = counts only.
- Styling: component props first; otherwise `style`/`className` with tokens
  (`var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)`). No raw hex/px in components.
  No StyleX/Tailwind compiler for Astryx components (no `xstyle`).
- Brand values live in the theme: `src/theme/studioTheme.ts` (`defineTheme`, studio accent
  from the DB, Inter typography, heading tracking via `components.heading`). Never
  override `--color-*` in `:root`.
- CSS layers (`src/styles/app.css`): `reset, theme, base, astryx-base, astryx-theme,
  components, utilities, app`. App-only CSS (glass lens, safe areas, slot grid) goes in
  `@layer app` and uses tokens.
- The booking bottom sheet is the shadcn **Base UI** Drawer (`src/components/ui/drawer.tsx`).
  Do not import Vaul or mix its props; Astryx `BottomSheet` is not used for booking.
- Icons: Phosphor (`@phosphor-icons/react`), registered for Astryx in `src/theme/icons.tsx`.

## 3. Self-check before finishing

Re-read the file: replace raw layout elements, imported CSS and hardcoded values with
components or tokens; confirm the template frame, gap and padding survived; if unsure a
prop exists, run `pnpm exec astryx component <Name>` or `pnpm exec astryx search "<thing>"`.
Then run the `ui-ux-pro-max` pre-delivery checklist (`references/pro-rules.md`).

## CLI reference

```
search "<query>"      component / doc / template / block / theme
component --list      all components by category
template --list       page + block recipes
docs <topic>          layout, tokens, theme, typography, color, spacing, motion, icons, …
doctor                setup diagnostics
upgrade --from <v> --apply   after bumping @astryxdesign/*
```
