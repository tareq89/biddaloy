/**
 * Shared design tokens — the single source of truth every SPA extends.
 *
 * Colour values are plain hex here rather than references to Tailwind's own
 * default palette: Tailwind v4 tree-shakes `@theme` CSS variables down to
 * whatever utility classes are actually used in a build, so a variable that
 * is only ever reached through a dynamically-built class name (as semantic
 * status tokens are) can silently disappear. Literal values sidestep that.
 *
 * `ui/src/styles/globals.css` mirrors these into a Tailwind v4 `@theme`
 * block by hand. `scripts/check-contrast.mjs` parses both this file and that
 * one and fails if a value drifts between them, so the duplication cannot go
 * unnoticed.
 *
 * Every foreground/background pair actually used by a component is checked
 * against WCAG 2.2 by that same script — see CONTRAST_PAIRS at the bottom.
 * Values were not taken from memory; they were computed and iterated against
 * the real relative-luminance formula before being written here.
 */

export const neutral = {
  0: '#ffffff',
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0', // decorative dividers only — ~1.2:1 on white, below the 3:1 a
  // functional border needs. Use `neutral[500]` for anything conveying state.
  400: '#94a3b8',
  500: '#64748b', // functional border / focus-adjacent minimum — clears 3:1 on white
  600: '#475569', // secondary text — clears 4.5:1 on white
  700: '#334155',
  900: '#0f172a', // primary text and dark-mode page background
  950: '#020617',
} as const;

export const brand = {
  50: '#eff6ff',
  100: '#dbeafe',
  400: '#60a5fa', // dark-mode link/text — clears 4.5:1 on neutral-900
  600: '#2563eb', // light-mode link/text and interactive component colour
  700: '#1d4ed8', // light-mode link/text, higher-contrast variant
} as const;

export const radius = {
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
} as const;

/**
 * Spacing and typography are deliberately absent from this file. Tailwind
 * v4's own default scale (`p-4`, `text-lg`, `gap-2`, ...) is already a
 * coherent, well-tested system — redefining it here would only be
 * duplication with no functional benefit, since nothing about a fee-payment
 * admin UI needs a spacing or type scale different from Tailwind's own. A
 * custom scale is worth adding the moment a real need appears (an unusual
 * type ramp, a non-4px spacing grid); until then, extending it means every
 * SPA gets it for free by importing `@beton-boi/ui/tailwind` — there is
 * nothing to wire up.
 */

/**
 * Fee/invoice/payment status. Each state pairs a colour with a distinct
 * icon so the meaning survives red/green colour-vision deficiency, the most
 * common form and exactly the distinction this product relies on most
 * (paid vs. overdue). The icon is not decoration — StatusBadge (epic 8.6)
 * depends on every status here carrying one.
 *
 * `fg` is verified at >=4.5:1 against both `#ffffff` and its own `bg`. `bg`
 * is a light tint meant only as a badge background, never as a text colour.
 */
export const status = {
  paid: { fg: '#15803d', bg: '#dcfce7', fgDark: '#4ade80', icon: 'check-circle' },
  partial: { fg: '#0e7490', bg: '#cffafe', fgDark: '#22d3ee', icon: 'circle-half' },
  due: { fg: '#b45309', bg: '#fef3c7', fgDark: '#fbbf24', icon: 'clock' },
  overdue: { fg: '#b91c1c', bg: '#fee2e2', fgDark: '#f87171', icon: 'alert-triangle' },
} as const;

/**
 * Semantic role tokens — what a component should actually reach for. `bg`,
 * `surface`, `textPrimary` etc. keep a fixed *meaning* across themes, unlike
 * `neutral`/`brand` above which keep a fixed *value*. A component built from
 * roles instead of raw scale entries switches themes for free; one built
 * from `neutral[900]` directly does not, and light/dark can end up
 * mismatched (e.g. light text rendered on a light background) if only one
 * side of a pair is swapped.
 */
export const light = {
  bg: neutral[0],
  surface: neutral[50],
  textPrimary: neutral[900],
  textSecondary: neutral[600],
  border: neutral[500],
  brand: brand[600],
} as const;

/**
 * Dark-mode values, defined now per [8.1.2] so the tokens exist before any
 * SPA exposes a theme toggle. Deliberately reached only through
 * `:root[data-theme="dark"]` in globals.css, never `@media
 * (prefers-color-scheme: dark)` — the latter would activate for every user
 * with a dark OS preference today, which is exposure, not preparation.
 */
export const dark = {
  bg: neutral[900],
  surface: '#1e293b',
  textPrimary: neutral[50],
  textSecondary: '#cbd5e1',
  border: neutral[500], // same value as light mode; verified separately below
  brand: brand[400],
} as const;

export type StatusKey = keyof typeof status;

/**
 * Every pair `check-contrast.mjs` verifies against WCAG 2.2: 4.5:1 for text,
 * 3:1 for UI components/meaningful graphics. Add a line here for every new
 * foreground/background combination a component actually renders — an
 * unlisted pair is an unverified one.
 */
export const CONTRAST_PAIRS = [
  { name: 'neutral-900 text on white', fg: neutral[900], bg: neutral[0], min: 4.5 },
  { name: 'neutral-600 text on white', fg: neutral[600], bg: neutral[0], min: 4.5 },
  { name: 'brand-700 text on white', fg: brand[700], bg: neutral[0], min: 4.5 },
  { name: 'brand-600 text on white', fg: brand[600], bg: neutral[0], min: 4.5 },
  { name: 'light textPrimary on light bg', fg: light.textPrimary, bg: light.bg, min: 4.5 },
  { name: 'light textSecondary on light bg', fg: light.textSecondary, bg: light.bg, min: 4.5 },
  { name: 'light border on light bg', fg: light.border, bg: light.bg, min: 3 },
  { name: 'paid fg on white', fg: status.paid.fg, bg: neutral[0], min: 4.5 },
  { name: 'paid fg on paid bg', fg: status.paid.fg, bg: status.paid.bg, min: 4.5 },
  { name: 'partial fg on white', fg: status.partial.fg, bg: neutral[0], min: 4.5 },
  { name: 'partial fg on partial bg', fg: status.partial.fg, bg: status.partial.bg, min: 4.5 },
  { name: 'due fg on white', fg: status.due.fg, bg: neutral[0], min: 4.5 },
  { name: 'due fg on due bg', fg: status.due.fg, bg: status.due.bg, min: 4.5 },
  { name: 'overdue fg on white', fg: status.overdue.fg, bg: neutral[0], min: 4.5 },
  { name: 'overdue fg on overdue bg', fg: status.overdue.fg, bg: status.overdue.bg, min: 4.5 },
  { name: 'dark text-primary on dark bg', fg: dark.textPrimary, bg: dark.bg, min: 4.5 },
  { name: 'dark text-secondary on dark bg', fg: dark.textSecondary, bg: dark.bg, min: 4.5 },
  { name: 'dark brand text on dark bg', fg: dark.brand, bg: dark.bg, min: 4.5 },
  { name: 'dark functional border on dark bg', fg: dark.border, bg: dark.bg, min: 3 },
  { name: 'paid fgDark on dark bg', fg: status.paid.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'partial fgDark on dark bg', fg: status.partial.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'due fgDark on dark bg', fg: status.due.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'overdue fgDark on dark bg', fg: status.overdue.fgDark, bg: dark.bg, min: 4.5 },
] as const;

export const betonBoiPreset = { neutral, brand, radius, status, light, dark } as const;

export default betonBoiPreset;
