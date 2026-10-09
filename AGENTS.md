# AGENTS

Project-specific guidance for AI coding agents.

## Project rules (studio booking PWA)

- One shared JS/CSS build serves every studio at `/s/{slug}/` and `/s/{slug}/owner/`.
  Business names, prices, addresses, phones, colors and photos never appear in `src/`:
  they live in `tenants/<slug>/business.json` (pipeline input) and in the database
  (runtime source). `pnpm check:no-business-strings` enforces it.
- Every tenant-dependent table has `tenant_id` and composite FKs `(tenant_id, id)`.
  Writes go through SECURITY DEFINER RPCs that check membership; anon has no table grants.
- Bookings and blocks share `resource_occupancies` (EXCLUDE constraint). Never compute
  price, tenant or duration on the client.
- Server secrets (service role, LLM key, VAPID private key) stay in Supabase secrets.
- UI: Astryx components first (run `pnpm exec astryx component <Name>` before using an
  unknown prop), tokens for every value, shadcn only for the Base UI Drawer in
  `src/components/ui`. Keep the CSS layer order declared in `src/styles/app.css`.
- Design skills (installed in `.claude/skills/`) are mandatory for any UI change:
  `astryx` (template-first Astryx workflow) and `ui-ux-pro-max` (design intelligence;
  run `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <d>`).
  The agreed design system is `design-system/studio-booking/MASTER.md`; page overrides go
  in `design-system/studio-booking/pages/`. Finish UI work with the pre-delivery checklist
  in `.claude/skills/ui-ux-pro-max/references/pro-rules.md` and screenshots at 375px and 1440px.
- Every network screen renders loading / error / empty / success states.
- Run `pnpm verify` (typecheck, lint, unit, db tests) before committing.

<!-- ASTRYX:START -->
Astryx v0.6.6 · 168 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template. Never lay out a page from scratch:
1. `astryx build "<idea>"` — START HERE: names the [page] template to start from (always one: the closest match, or the app shell), two other templates, and the [block]s + [component]s for parts it lacks. No args = full playbook.
2. `astryx template <name> <path>` — scaffold that template into your project. Keep its frame, gap and padding; replace its data, copy and sections; delete sections you do not need.
3. `astryx template <Block>` for a part the template lacks; `astryx component <Name>` for props + examples before you use or change a component.
Changing a page you already have? Keep it: skip step 2 and add blocks and components inside its sections.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: the template you scaffold sets the page frame. Read `astryx docs layout` before you change it — region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). Confirm the page kept its template's frame, gap and padding. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block / theme
  discover <words>   integrations you could add, and the ones you have
  component --list   168 components by category
  template --list    page + block recipes
  docs <topic>       authoring, browser-support, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  docs cli           commands, API reference, integration authoring (one level at a time)
  swizzle <Name>     eject component source for deep customization
  upgrade --from <old version> --apply   run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->
