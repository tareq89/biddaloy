# Design Direction — Epic 8.13 Visual Design Layer

**Status:** approved 2026-08-28 · **Decided in:** [#342](https://github.com/tareq89/biddaloy/issues/342) · **Implemented by:** #343–#354

This is the agreed _look_ of Biddaloy: the exact type, colour, elevation,
border, density and motion values that epic 8.13 puts into the code.

**Approved mockups:** [six artboards](https://claude.ai/code/artifact/7d5dc600-404b-42b4-8067-e6997434fb7a)
— guardian portal landing (360 px, Bangla), admin invoice list (1280 px,
English) and the record-payment form, each in light and dark, rendered with
every value below.

Read this before touching `ui/tailwind.preset.ts` or
`ui/src/styles/globals.css`. It exists so that no implementation ticket has
to invent a value. Every hex, every pixel and every millisecond below was
decided here and verified here.

---

## 1. Why this document exists

Biddaloy today uses stock Tailwind defaults: `blue-600` as the brand, the
system font stack, `shadow-sm/md/lg` picked ad hoc, one border colour for
everything. That is not _wrong_ — it is _unowned_. It reads as a template.

Epic 8.13 fixes that by changing three files, which then propagate to
roughly fifty components:

```mermaid
flowchart LR
  DD["09-design-direction.md<br/>(this file — the decisions)"]
  P["ui/tailwind.preset.ts<br/>(JS token source of truth)"]
  G["ui/src/styles/globals.css<br/>(Tailwind v4 @theme mirror)"]
  C["check-contrast.mjs<br/>(drift + WCAG gate)"]
  U["~50 components in ui/src<br/>+ client-admin routes"]

  DD --> P
  DD --> G
  P --> C
  G --> C
  P --> U
  G --> U
```

`ui/scripts/check-contrast.mjs` reads _both_ the preset and the CSS, but
it only guards names it has been told about: the raw neutral/brand scales,
radius, the status vars, and the six role vars in its `roleVarNames` map.
A token it has never heard of drifts freely. So every ticket below that
introduces a token family also extends the gate, in the same PR:

| Ticket | Adds to `ui/tailwind.preset.ts`            | Adds to `check-contrast.mjs`                              |
| ------ | ------------------------------------------ | --------------------------------------------------------- |
| #345   | `light.borderSubtle` / `dark.borderSubtle` | `borderSubtle: '--color-border-subtle'` in `roleVarNames` |
| #346   | a `shadows` export (e1–e3, light + dark)   | drift check for the `--elevation-*` wiring, three scopes  |
| #347   | a `motion` export (durations, easings)     | drift check for `--motion-*` (same value in both scopes)  |

The density vars in §6 (`--control-h`, row heights) are set per shell by a
`data-density` attribute, not declared in `@theme` — they sit outside this
gate, stated here so nobody assumes otherwise.

"Three scopes" for #346 is not a typo, and it is the one place this document
originally got the mechanism wrong. §5 below explains why; the short version
is that a shadow cannot be themed from `@theme` the way a colour can, so the
values do not live where the other families' values live.

---

## 2. Typography — one superfamily, two scripts

Biddaloy renders Bengali and English side by side. A guardian sees
`পরিশোধিত ৳ ১,২০০` on the same row as a Latin date. Two unrelated
typefaces would show two different apparent weights on one line.

**Decision: Anek Latin + Anek Bangla (Ek Type), served under one CSS family
name `Biddaloy Sans`.**

Anek is a multiscript superfamily whose scripts were drawn together — shared
x-height logic, shared apparent weight, shared vertical proportions. Inter
and Geist have no Bengali sibling at all, which disqualifies them here.

Licence: SIL OFL 1.1 for both. Self-hosting is permitted.

### How the two faces are wired

One family name, split by Unicode range, so the browser picks the script
automatically with no `lang`-based CSS:

```mermaid
flowchart TD
  T["Text node: 'Rahim — ফি পরিশোধ'"]
  T -->|"U+0000–00FF etc."| L["@font-face Biddaloy Sans<br/>src: anek-latin.woff2"]
  T -->|"U+0980–09FF etc."| B["@font-face Biddaloy Sans<br/>src: anek-bangla.woff2"]
  L --> R["One visual line, one apparent weight"]
  B --> R
```

Concrete `unicode-range` values #343 must ship:

| Face           | `unicode-range`                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Anek Latin VF  | `U+0000-00FF, U+0131, U+0152-0153, U+2013-2014, U+2018-201A, U+201C-201E, U+2022, U+2026, U+2212` |
| Anek Bangla VF | `U+0980-09FF, U+0964-0965, U+200C-200D, U+25CC`                                                   |

The Taka sign `৳` is `U+09F3`, inside the Bengali block — it comes from the
Bangla face, which is correct: it should match the Bangla numerals beside it.

Both faces: `font-display: swap`, variable `wght` axis subset to **400–800**
for Latin and **400–700** for Bangla (see the budget table below for why),
`wdth` axis **pinned to 100** via `fonttools varLib.instancer` (dropping an
axis is a large byte win and Biddaloy never uses width variation).

**Fallback stack:** `'Biddaloy Sans', system-ui, 'Segoe UI', sans-serif`, plus
a metric-matched local fallback `@font-face` using `size-adjust`,
`ascent-override`, `descent-override` and `line-gap-override` so the swap
does not move layout. The `0.1` CLS budget in `lighthouserc.cjs` currently
runs only against `/login` and `/fees/dues` (plus a seeded student-detail
URL appended in CI) — the portal landing page is not measured today. #343
adds `http://localhost:5174/portal` to that url list in the same PR,
because the portal landing is the page a font swap is most likely to
shift.

### Webfont budget

| Asset                                  | Budget (woff2) | Measured in #343        |
| -------------------------------------- | -------------- | ----------------------- |
| Anek Latin VF, subset, `wght` 400–800  | **45 KB**      | 38,720 B (37.8 KB) ✅   |
| Anek Bangla VF, subset, `wght` 400–700 | **135 KB**     | 135,952 B (132.8 KB) ✅ |
| **Total**                              | **180 KB**     | 174,672 B (170.6 KB) ✅ |

**Relief valve used.** At the originally specified `wght` 400–800 the Bangla
subset measured **141,116 B (137.8 KB)** — over budget. #343 applied the
sanctioned narrowing to 400–700, which is where the 135,952 B above comes
from. The heaviest step in the ramp is 620, so nothing in this document is
lost; only the Latin face still reaches 800.

Lighthouse CI (`lighthouserc.cjs`) throttles to 700 kbps / 400 ms RTT / 4×
CPU on a 360×640 viewport, with `LCP ≤ 4000 ms`. 180 KB at 700 kbps is
about 2.1 s of transfer, and `font-display: swap` means text paints from
the metric-matched fallback immediately — the font is not on the LCP path.

**Relief valve, if a re-subset measures over budget:** narrow the Bangla
`wght` range from 400–800 to 400–700 (already applied, see above); do not
silently exceed 180 KB.

### Measured metric-override numbers

The metric-matched fallback described above needs real numbers, which only
exist once the subsets exist. #343 measured them with
`node ui/scripts/fonts/build-fonts.mjs --metrics` and committed them into
`globals.css`:

| Fallback face                  | `size-adjust` | `ascent-override` | `descent-override` | `line-gap-override` |
| ------------------------------ | ------------- | ----------------- | ------------------ | ------------------- |
| Latin, vs `Arial`              | 113.274%      | 79.453%           | 17.656%            | 0%                  |
| Bangla, vs `Noto Sans Bengali` | 115.053%      | 108.646%          | 53.541%            | 0%                  |

Derived with the web.dev "Improved font fallbacks" formula from the shipped
subsets' own `head`/`hhea`/`OS/2` tables — Latin 2000 upm, 1800/−400/0,
xAvg 1000; Bangla 2000 upm, 2500/−1232/0, xAvg 1307.

**No preload.** The LCP reasoning above only works while the fonts stay off
the critical path: `font-display: swap` plus the metric-matched fallback
means text paints before the fonts arrive. A `<link rel="preload">` would put
170 KB back on that path, so #343 deliberately shipped none, and the PWA
precache globs in `client-admin/vite.config.ts` deliberately do not match
`.woff2` either.

### The ramp

`rem` values assume a 16 px root. Line-heights are deliberately loose:
Bengali has a taller vertical extent than Latin at the same font size.

| Step      | Size / line | Weight | Tracking | Used for                   |
| --------- | ----------- | ------ | -------- | -------------------------- |
| `display` | 28 / 36 px  | 620    | −0.01em  | Portal page title          |
| `h1`      | 22 / 30 px  | 620    | −0.01em  | Admin page titles          |
| `h2`      | 18 / 26 px  | 600    | 0        | Section headings           |
| `h3`      | 16 / 24 px  | 600    | 0        | Card headings              |
| `body-lg` | 16 / 26 px  | 400    | 0        | Portal default body        |
| `body`    | 14 / 22 px  | 400    | 0        | Admin default body         |
| `label`   | 13 / 18 px  | 500    | 0        | Form labels, table headers |
| `caption` | 12 / 17 px  | 400    | 0        | Help text, timestamps      |

Two more rules:

- **Money and number columns use `font-variant-numeric: tabular-nums`**, so
  amounts in an invoice table align on the decimal.

  Honest limitation: this works on **Latin digits only** (`REGION_BD_EN`, e.g.
  `৳ 12,345.00`). The shipped `anek-bangla.woff2` subset has no `tnum` GSUB
  feature and its Bengali digits have proportional advance widths, so
  `tabular-nums` is a **no-op on Bengali numerals** — and `bn` is the app's
  default locale (`ui/src/i18n/locale-storage.ts`). Bangla money columns
  therefore do **not** align on the decimal; we keep the class on every money
  column anyway because it is correct under `en` and harmless under `bn`.
  Fixing it properly would mean a Bangla face that ships tabular figures, which
  no subset of Anek Bangla provides, so this is a documented limitation rather
  than a promise the code cannot keep.

- **No italic faces are shipped.** This UI never needs them, and skipping
  them saves bytes on both scripts.

---

## 3. Colour — "ink on paper"

### 3.1 The brand hue

**Decision: a deep indigo we call "ink". `brand-600` becomes `#4a3fd4`,
replacing the stock `#2563eb`.**

Why indigo, and why not the obvious alternatives:

| Candidate                             | Verdict                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind `blue-600` `#2563eb` (today) | Rejected — it is the default every framework ships. It is why the product reads as unstyled.                                                                                           |
| Bangladesh green `#006a4e`            | **Rejected.** Green already means `paid` in the fees product. A green brand would make every screen look like a success state, and would force a re-grade of the whole status palette. |
| Deep indigo "ink" `#4a3fd4`           | **Chosen.** Fountain-pen ink suits a school product. It is the only hue region not already claimed by a status colour.                                                                 |

The four status colours already occupy most of the wheel — paid ≈ 140°,
partial ≈ 192°, due ≈ 40°, overdue ≈ 0°. Indigo (≈ 245°) is genuinely free.

### 3.2 The brand ramp

| Token       | Value     | Verified contrast                                               |
| ----------- | --------- | --------------------------------------------------------------- |
| `brand-50`  | `#eef1fe` | Tint only — never a text colour                                 |
| `brand-100` | `#dfe3fd` | Tint only                                                       |
| `brand-400` | `#8f96f4` | 6.66:1 on dark bg `#0f172a`; 5.46:1 on dark surface `#1e293b`   |
| `brand-600` | `#4a3fd4` | 7.11:1 on white; 6.80:1 on ground `#f8fafc`; white on it 7.11:1 |
| `brand-700` | `#3d33b8` | 8.88:1 on white; 7.89:1 on `brand-50`; 7.00:1 on `brand-100`    |

Every ratio above was computed with the same WCAG 2.2 relative-luminance
formula `ui/scripts/check-contrast.mjs` uses. They are exact, not estimates.

### 3.3 Ground and surface — the inversion

This is the single change that does the most visual work, and it costs no
new colour at all.

Today: the page is white (`light.bg = neutral[0]`) and cards are grey
(`light.surface = neutral[50]`). Cards sink into the page.

**Decision: swap the two roles.**

```mermaid
flowchart LR
  subgraph Before["Before — cards sink"]
    B1["page #ffffff"] --> B2["card #f8fafc"]
  end
  subgraph After["After — cards lift"]
    A1["page #f8fafc (ground)"] --> A2["card #ffffff (surface)"]
  end
```

| Role                            | Before                  | After                   |
| ------------------------------- | ----------------------- | ----------------------- |
| `light.bg` (page ground)        | `neutral[0]` `#ffffff`  | `neutral[50]` `#f8fafc` |
| `light.surface` (cards, panels) | `neutral[50]` `#f8fafc` | `neutral[0]` `#ffffff`  |

**No neutral scale value changes.** Only which role points at which value.
That keeps `check-contrast.mjs`'s drift check purely mechanical.

**The role swap alone does not produce the picture below — on its own it
makes things worse.** Nearly every surface component paints
`bg-background`, and `--color-background` aliases `--color-bg` — the
_ground_ role. After the swap those components repaint `#f8fafc`. The
utility that reads the _surface_ role is `bg-card` (`--color-card` →
`--color-surface`). So the inversion ships in three parts: #344 swaps the
roles, #348 makes the page itself read the ground token, and #350 moves
every lifted surface to `bg-card`.

Between those tickets the epic branch renders an **inverted interim
state**, and this is expected rather than a defect. #344 alone leaves
`client-admin/index.html`'s `<body>` hardcoded to `bg-white` (that line is
#348's), so cards, the bottom nav, outline buttons and the active tab
render `#f8fafc` on a white page — grey panels on white, which is exactly
the _Before_ "cards sink" picture this section sets out to fix. It is safe
to pass through because the epic merges to `main` as a **single PR**, so
no user ever sees a branch state; and because every text and border pair
on the new ground still clears AA, so accessibility does not regress while
it is in that state. Do not "fix" it inside #344 by pulling #348's or
#350's work forward — that collapses three reviewable tickets into one.

```mermaid
flowchart LR
  BB["bg-background<br/>ground #f8fafc"] --> G["page shells only"]
  BC["bg-card<br/>surface #ffffff"] --> S["everything that lifts:<br/>cards, bars, fields"]
```

| Call site                                                                                                                                                                            | Today                               | #350 changes it to                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------- |
| `ui/src/components/card.tsx:35`                                                                                                                                                      | `bg-background`                     | `bg-card`                                                      |
| `ui/src/components/bottom-nav.tsx:72`                                                                                                                                                | `bg-background`                     | `bg-card`                                                      |
| `ui/src/components/student-picker.tsx:67`                                                                                                                                            | `bg-background`                     | `bg-card`                                                      |
| `ui/src/components/skip-link.tsx:24`                                                                                                                                                 | `bg-background`                     | `bg-card`                                                      |
| `ui/src/primitives/tabs.tsx:59` (active trigger)                                                                                                                                     | `data-[state=active]:bg-background` | `data-[state=active]:bg-card`                                  |
| `ui/src/primitives/button.tsx:14` (outline variant)                                                                                                                                  | `bg-background`                     | `bg-card`                                                      |
| `ui/src/primitives/input.tsx:11`                                                                                                                                                     | `bg-transparent`                    | `bg-card` — a field reads as fillable white on the grey ground |
| `client-admin` raw inputs: `components/SecretField.tsx:86`, `pages/SchoolSettingsPage.tsx:75`, `pages/settings/SmsSection.tsx:172`, `pages/settings/RegionalSection.tsx:164,230,267` | `bg-background`                     | `bg-card`                                                      |

That is ~12 call sites plus their tests — #350 is materially bigger than
its original "swap six shadow classes" shape. §9 says so on its row.

Verified on the new `#f8fafc` ground:

| Pair                                      | Ratio   | Minimum |
| ----------------------------------------- | ------- | ------- |
| `neutral-900` text on ground              | 17.06:1 | 4.5     |
| `neutral-600` text on ground              | 7.24:1  | 4.5     |
| `neutral-500` functional border on ground | 4.55:1  | 3       |
| `brand-600` on ground                     | 6.80:1  | 4.5     |
| `paid` fg `#15803d` on ground             | 4.79:1  | 4.5     |
| `partial` fg `#0e7490` on ground          | 5.12:1  | 4.5     |
| `due` fg `#b45309` on ground              | 4.80:1  | 4.5     |
| `overdue` fg `#b91c1c` on ground          | 6.18:1  | 4.5     |

**Known consequences, each with a decided treatment** (today
`--color-secondary`, `--color-muted` and `--color-accent` in `globals.css`
are all aliases of `--color-surface`, so the swap reaches further than
cards):

1. `--color-secondary` **stays** an alias of `--color-surface`: secondary
   buttons become white pills on the grey ground. Intended — the
   fee/invoice mockup shows it. Their hover already darkens via
   `color-mix`, so the hover direction survives.

   **Known limitation, allocated to #351. #351 must ship both a token/variant
   change _and_ a real boundary — a border alone or a surface alone is not
   enough.** The white-pill reasoning holds for page-level chrome sitting on
   the ground, but not inside the card interiors this same section turns
   white. `ui/src/primitives/button.tsx` renders the secondary variant as
   `bg-secondary text-secondary-foreground`, and the shared base class string
   sets `border border-transparent` — so there is no boundary either.
   Measured, with `--color-secondary` aliasing `--color-surface`:

   | Secondary button sits on  | Button fill | Behind it | Contrast   | SC 1.4.11 needs |
   | ------------------------- | ----------- | --------- | ---------- | --------------- |
   | a `bg-card` panel (light) | `#ffffff`   | `#ffffff` | **1.00:1** | 3:1             |
   | the page ground (light)   | `#ffffff`   | `#f8fafc` | **1.03:1** | 3:1             |
   | a `bg-card` panel (dark)  | `#1e293b`   | `#1e293b` | **1.00:1** | 3:1             |

   Dark mode is the same shape, not a saving grace: `--color-secondary` and
   `--color-card` both resolve to `#1e293b`. The button is invisible in both
   themes until its `color-mix(… 5%)` hover fires — and hover is not
   available to keyboard or touch users, so it does not count.

   This is latent today — no `variant="secondary"` call site exists anywhere —
   and becomes a real defect the moment one is added. #351 owns the fix, not
   #344: changing the token value here would undo the deliberate white-pill
   decision above.

2. `--color-muted` and `--color-accent` **stop** aliasing
   `--color-surface`. Kept as aliases they turn white, and every
   `hover:bg-muted` / `focus:bg-accent` highlight becomes white-on-white —
   invisible inside a white card or popover. #344 re-points both to
   `neutral-100` `#f1f5f9` in light mode; the dark block keeps
   `var(--color-surface)`. Verified: `neutral-600` muted text on
   `#f1f5f9` is 6.92:1, `neutral-900` on it is 16.30:1.
3. The outline button (`ui/src/primitives/button.tsx:14`,
   `bg-background hover:bg-muted`) would otherwise _invert its hover
   direction_: resting grey — invisible against the grey page — and hover
   white. With the two fixes above it rests `bg-card` white and hovers to
   `#f1f5f9`, the same direction as today.
4. The AdminShell sidebar. **An earlier draft of this section described
   tokens that nothing renders.** The `--color-sidebar-*` group is dead
   code: `bg-sidebar`, `bg-sidebar-accent` and `bg-sidebar-primary` appear
   in no component in `ui/src` or `client-admin/src`. What actually paints
   the rail is `bg-muted/30` (`ui/src/components/app-shell.tsx:333`), and
   nav state is `hover:bg-accent` plus `activeProps: 'bg-accent'`
   (`app-shell.tsx:160-161`).

   So the token that really governs the nav is `--color-accent`, which
   §3.3 re-points to `neutral-100` `#f1f5f9`. The honest consequence:
   hovered and selected nav items get **darker** — a light grey wash —
   rather than lifting to white as the earlier draft claimed. The rail
   itself becomes `neutral-100` at 30% over the page. **Approved as-is**:
   a subtly tinted rail beside lifting white content is the intended
   relationship, and a darker-on-hover nav is conventional for a rail that
   is itself tinted. The `brand-50`/`brand-700` selected-item treatment
   (7.89:1, §3.6) is **not** implemented and is not implied by this
   ticket; #351 owns interactive states, and #353 owns deciding whether to
   wire the `--color-sidebar-*` group up or delete it.

### 3.4 Dark mode

| Role                                      | Value     | Change?                      |
| ----------------------------------------- | --------- | ---------------------------- |
| `dark.bg`                                 | `#0f172a` | unchanged                    |
| `dark.surface`                            | `#1e293b` | unchanged                    |
| `dark.textPrimary`                        | `#f8fafc` | unchanged                    |
| `dark.textSecondary`                      | `#cbd5e1` | unchanged                    |
| `dark.brand`                              | `#8f96f4` | **changed** — was `#60a5fa`  |
| `--color-primary-foreground` (dark scope) | `#0f172a` | **new override** — see below |

Status `fgDark` values are unchanged. Status light tints (`-bg`) stay
light-scope-only.

**White text on the dark primary button fails AA.** `globals.css:98` sets
`--color-primary-foreground: var(--color-neutral-0)` once, and the
`:root[data-theme="dark"]` block never overrides it. A dark primary button
therefore renders white on `--color-brand-400` `#8f96f4` = **2.68:1**.
#344 adds the override `--color-primary-foreground: var(--color-neutral-900)`
to the dark block — `#0f172a` on `#8f96f4` is 6.66:1 — in the same PR that
changes `dark.brand`.

### 3.4.1 The `dark:` variant is wired to the wrong switch

The token overrides key off `:root[data-theme="dark"]`. But no
`@custom-variant dark` exists anywhere in `ui/src` or `client-admin/src`,
so Tailwind v4 compiles every `dark:` utility to
`@media (prefers-color-scheme: dark)` — the OS setting, not the attribute:

```mermaid
flowchart LR
  A["data-theme='dark' flipped<br/>by #353's toggle"] --> T["token overrides apply ✓"]
  A -.->|"no effect"| U["dark: utilities in button.tsx:14,<br/>input.tsx:11, tabs.tsx:57,<br/>dropdown-menu.tsx"]
  OS["OS prefers-color-scheme"] --> U
```

Flip the attribute on a light-OS machine and those utilities stay inert —
a half-dark UI. **#348 adds one line to `globals.css`, so it lands before
#353 ships a toggle:**

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

(This is the form Tailwind v4 documents for attribute-driven dark mode;
verify against the installed 4.x minor at implementation time.)

### 3.5 Status colours — unchanged

All four states keep their existing `fg` / `bg` / `fgDark` values and their
paired icons (`check-circle`, `circle-half`, `clock`, `alert-triangle`).
Colour is never the only signal. This epic does not touch them.

### 3.6 `CONTRAST_PAIRS` — what actually changes in the file

Every line below is pre-computed and passes. But not every line is a new
row: `CONTRAST_PAIRS` in `ui/tailwind.preset.ts` already holds four of
them as _references_ (`brand[600]`, `brand[700]`, `dark.brand`,
`light.border`/`light.bg`), which re-verify the new values automatically
once #344/#345 change what the references point at. Two more are symmetric
duplicates, which the file's own convention skips (contrast is symmetric).
Adding those six again would be duplicates. The file gains **three new
rows and two literal updates**, all in #344:

| Name                                      | fg        | bg        | min | actual | Status in `CONTRAST_PAIRS`                                                                        |
| ----------------------------------------- | --------- | --------- | --- | ------ | ------------------------------------------------------------------------------------------------- |
| brand-600 text on white                   | `#4a3fd4` | `#ffffff` | 4.5 | 7.11   | exists — `brand[600]` ref, auto-updates                                                           |
| white on brand-600 (primary button)       | `#ffffff` | `#4a3fd4` | 4.5 | 7.11   | symmetric of the row above — no entry                                                             |
| brand-700 text on white                   | `#3d33b8` | `#ffffff` | 4.5 | 8.88   | exists — `brand[700]` ref, auto-updates                                                           |
| brand-700 on brand-50 (selected nav item) | `#3d33b8` | `#eef1fe` | 4.5 | 7.89   | **add**                                                                                           |
| brand-600 on ground                       | `#4a3fd4` | `#f8fafc` | 4.5 | 6.80   | **add**                                                                                           |
| brand-400 on dark bg                      | `#8f96f4` | `#0f172a` | 4.5 | 6.66   | exists — `dark brand text on dark bg`, `dark.brand` ref                                           |
| brand-400 on dark surface                 | `#8f96f4` | `#1e293b` | 4.5 | 5.46   | **add**                                                                                           |
| dark primary-button text on brand-400     | `#0f172a` | `#8f96f4` | 4.5 | 6.66   | symmetric of `brand-400 on dark bg` — no entry                                                    |
| functional border on ground               | `#64748b` | `#f8fafc` | 3   | 4.55   | exists — `light border on light bg`, `light.border`/`light.bg` refs                               |
| muted-foreground on muted                 | `#475569` | `#f1f5f9` | 4.5 | 6.92   | **update** — the literal row's bg moves `neutral[50]` → `neutral[100]`, per §3.3's muted re-alias |
| secondary-foreground on secondary         | `#0f172a` | `#ffffff` | 4.5 | 17.85  | **update** — the literal row's bg moves `neutral[50]` → `neutral[0]`, per the inversion           |

The existing `light textPrimary on light bg` / `light textSecondary on
light bg` pairs re-verify the new ground role automatically, because they
reference `light.bg` rather than a literal.

**`--color-border-subtle` gets no pair, on purpose.** It is decorative — the same
`neutral-200` `#e2e8f0` that today's comment already documents as ~1.2:1 on
white and unfit for anything conveying state. See §4.

---

## 4. Borders — two roles, not one

Today `light.border` and `dark.border` are both `neutral[500]` `#64748b`,
and `card.tsx` draws its outline with it. A 4.55:1 line around every card
is visually loud: it is a _control_ border doing a _decoration_ job.

**Decision: split into two named roles.**

| Role                        | Light                   | Dark                    | Use for                                                               |
| --------------------------- | ----------------------- | ----------------------- | --------------------------------------------------------------------- |
| `--color-border-subtle`     | `neutral-200` `#e2e8f0` | `neutral-700` `#334155` | Card outlines, dividers, table rules — decoration                     |
| `--color-border-functional` | `neutral-500` `#64748b` | `neutral-500` `#64748b` | Inputs, selects, checkboxes, anything focus-adjacent — must clear 3:1 |

Concretely, `ui/src/components/card.tsx:35` today reads:

```
'rounded-lg border border-border bg-background'
```

After #345 + #346 + #350 it reads `border-border-subtle bg-card` plus
`shadow-e1` — a hairline and a lift, instead of a hard outline.

**Utility names, exactly.** Tailwind v4 derives the utility from the full
variable name after the namespace: `--color-border` → `border-border`, so
`--color-border-subtle` → **`border-border-subtle`** and
`--color-border-functional` → **`border-border-functional`**. There is no
`border-subtle` utility — written that way the class compiles to no colour
rule at all and the border falls back to a black `currentColor` hairline.
(`--shadow-e1` → `shadow-e1` is fine: the `shadow` namespace strips.)

Contrast rule: functional borders are gated at 3:1; subtle borders are
exempt because they never convey state. If a border ever _does_ convey
state (an error field, a selected row), it uses the functional role.

---

## 5. Elevation — three steps, each with a job

`ui/src` currently uses `shadow-sm` once, `shadow-md` three times and
`shadow-lg` twice, chosen ad hoc. Three named steps replace them.

| Token                                                | Light                                                                           | Dark                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `--shadow-e1`<br/>_cards, resting panels, tabs_      | `0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(15 23 42 / 0.06)`            | `0 1px 2px 0 rgb(0 0 0 / 0.40), 0 1px 3px 0 rgb(0 0 0 / 0.45)`            |
| `--shadow-e2`<br/>_dropdown, select, popover_        | `0 4px 6px -1px rgb(15 23 42 / 0.07), 0 8px 24px -4px rgb(15 23 42 / 0.10)`     | `0 4px 6px -1px rgb(0 0 0 / 0.50), 0 8px 24px -4px rgb(0 0 0 / 0.55)`     |
| `--shadow-e3`<br/>_dialog, drawer, toast, skip-link_ | `0 12px 24px -6px rgb(15 23 42 / 0.14), 0 24px 48px -12px rgb(15 23 42 / 0.18)` | `0 12px 24px -6px rgb(0 0 0 / 0.60), 0 24px 48px -12px rgb(0 0 0 / 0.65)` |

**Dark-mode rule:** a shadow alone does not read on `#0f172a`. So every
elevated surface in dark mode _also_ carries a 1px subtle border
(`border-border-subtle`, `#334155` in dark). Elevation in dark mode is a
border-plus-shadow pair, never a shadow alone.

### How these are actually wired (corrected in [8.13.5])

The obvious wiring — put the light values on `--shadow-e1..e3` in `@theme`
and override the same names in the dark block — **does not work**, and fails
silently. Tailwind v4 treats a `--shadow-*` theme variable as a build-time
value and inlines it into the utility rather than emitting a `var()`:

```css
/* what `--shadow-e1: 0 1px 2px 0 rgb(15 23 42 / 0.05)` in @theme compiles to */
.shadow-e1 {
  --tw-shadow: 0 1px 2px 0 var(--tw-shadow-color, rgb(15 23 42 / 0.05));
}
```

The numbers are baked in, so `.shadow-e1` never reads `--shadow-e1` at
runtime and a dark-block override of that name is dead CSS. No error, no
warning — dark mode just silently keeps the light shadow. Colour roles do not
have this problem because `bg-background` compiles to
`background-color: var(--color-bg)`.

The fix is one hop of indirection. `@theme` points the shadow at a plain
custom property; the values live in ordinary `:root` blocks, which are
runtime and therefore themeable:

```mermaid
flowchart LR
  T["@theme<br/>--shadow-e1: var(--elevation-e1)"] --> U[".shadow-e1<br/>--tw-shadow: var(--elevation-e1)"]
  L[":root<br/>--elevation-e1: light value"] --> U
  D[":root[data-theme=dark]<br/>--elevation-e1: dark value"] --> U
```

So three scopes, and `check-contrast.mjs` guards all three: `@theme` must
hold the `var(--elevation-*)` reference (not a literal — that is the
regression this catches), plain `:root` must hold `shadows.light`, and
`:root[data-theme="dark"]` must hold `shadows.dark`. Comparison is
character-exact, so `0.40` may not be shortened to `0.4`.

The values in the table above are unchanged by this correction; only where
they are written changed.

One accepted limitation: Tailwind's shadow-colour modifier (`shadow-e1/50`,
`shadow-e1 shadow-brand-600`) cannot reach inside an opaque `var()`, so it
has no effect on these steps. Nothing in the repo uses it.

Existing call sites map one-to-one — #350 makes these edits:

| File                                      | Today       | Becomes     |
| ----------------------------------------- | ----------- | ----------- |
| `ui/src/primitives/tabs.tsx:57`           | `shadow-sm` | `shadow-e1` |
| `ui/src/primitives/select.tsx:64`         | `shadow-md` | `shadow-e2` |
| `ui/src/primitives/popover.tsx:29`        | `shadow-md` | `shadow-e2` |
| `ui/src/primitives/dropdown-menu.tsx:36`  | `shadow-md` | `shadow-e2` |
| `ui/src/primitives/dropdown-menu.tsx:233` | `shadow-lg` | `shadow-e3` |
| `ui/src/components/skip-link.tsx:24`      | `shadow-lg` | `shadow-e3` |

---

## 6. Density — two numeric modes

"Comfortable" and "compact" are not adjectives here. They are numbers.

|                                        | **compact**<br/>staff routes (AdminShell), default | **comfortable**<br/>`/portal`, auth screens |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| Control height (button, input, select) | 32 px (today's `h-8`)                              | **44 px**                                   |
| Minimum interactive target             | 24 px (existing e2e gate)                          | **44 px** (WCAG SC 2.5.5)                   |
| Table / list row                       | 40 px                                              | ≥ 48 px                                     |
| Card padding                           | 16 px                                              | 20 px                                       |
| Page gutter                            | 24 px (desktop)                                    | 16 px (at 360 px)                           |
| Section gap                            | 24 px                                              | 24 px                                       |
| Default body step                      | `body` 14/22                                       | `body-lg` 16/26                             |

Why two: a staff member scanning 200 fee rows wants information density. A
guardian on a 360 px phone tapping one button wants a 44 px target.

**Mechanism (this is the direction #349 implements):** a
`data-density="comfortable"` attribute on the portal/auth shell sets CSS
variables (`--control-h`, `--row-h`). The size classes in
`ui/src/primitives/button.tsx` and `input.tsx` do **not** read any
variable today — they are literal `h-8` / `h-7` / `size-8`. #349 rewrites
each one to `h-[var(--control-h,<today's height>)]` (and
`size-[var(--control-h,<today's size>)]` for icon variants): where the
variable is unset — every compact shell — the fallback keeps today's exact
height, and the comfortable shell lifts every variant with one declaration,
`--control-h: 2.75rem`.

```mermaid
flowchart LR
  S["&lt;div data-density='comfortable'&gt;<br/>portal shell"] --> V["--control-h: 44px"]
  D["default (no attribute)<br/>staff shell"] --> V2["--control-h unset<br/>→ per-variant fallback"]
  V --> B["button.tsx / input.tsx<br/>h-[var(--control-h,…)] after #349's rewrite"]
  V2 --> B
```

The complete per-variant mapping #349 implements — every size variant
clamps to 44 px under comfortable, because WCAG SC 2.5.5 has no "small"
exception and `xs`/`sm` exist for dense staff tables, which are compact:

| Size variant       | Today (compact keeps it via fallback) | Comfortable |
| ------------------ | ------------------------------------- | ----------- |
| `button` `default` | `h-8` — 32 px                         | 44 px       |
| `button` `xs`      | `h-6` — 24 px                         | 44 px       |
| `button` `sm`      | `h-7` — 28 px                         | 44 px       |
| `button` `lg`      | `h-9` — 36 px                         | 44 px       |
| `button` `icon`    | `size-8` — 32 px                      | 44 px       |
| `button` `icon-xs` | `size-6` — 24 px                      | 44 px       |
| `button` `icon-sm` | `size-7` — 28 px                      | 44 px       |
| `button` `icon-lg` | `size-9` — 36 px                      | 44 px       |
| `input.tsx`        | `h-8` — 32 px                         | 44 px       |

**No component prop API changes.** No `<Button density="...">`. That
satisfies the epic's constraint that this layer stays invisible to callers.

---

## 7. Motion — three durations, two easings

| Token                    | Value                        | Used by                            |
| ------------------------ | ---------------------------- | ---------------------------------- |
| `--motion-duration-fast` | `120ms`                      | Hover, focus ring, active          |
| `--motion-duration-base` | `180ms`                      | Dropdown, popover, select, tooltip |
| `--motion-duration-slow` | `240ms`                      | Dialog, drawer, toast              |
| `--motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Enter and move                     |
| `--motion-ease-exit`     | `cubic-bezier(0.4, 0, 1, 1)` | Exit                               |

That is the entire motion vocabulary. Nothing else animates.

**Reduced motion is global, not per-component.** #347 adds one rule in
`globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 8. Brand colour outside the token files

Several places hardcode the brand hex outside `ui/`. All must change to
`#4a3fd4` in **#344**, or the PWA install banner, the browser tab and the
mobile browser chrome will keep showing the old blue:

| File                                         | What                              |
| -------------------------------------------- | --------------------------------- |
| `client-admin/index.html:18`                 | `<meta name="theme-color">`       |
| `client-admin/src/pwa/manifest.ts:30`        | `THEME_COLOR`                     |
| `client-admin/src/pwa/manifest.test.ts:38`   | the assertion on that constant    |
| `client-admin/public/favicon.svg:2`          | the `<rect fill>` behind the "B"  |
| `client-admin/public/icons/pwa-192.png`      | raster install icon (same mark)   |
| `client-admin/public/icons/pwa-512.png`      | raster install icon (same mark)   |
| `client-admin/public/icons/maskable-512.png` | maskable install icon (same mark) |

The bottom four rows were missed when this section was first written and
were found during #344; recorded here per §10.3. There is no SVG→PNG step
in the repo and no rasteriser on the build image, so the three PNGs were
re-coloured in place rather than re-rendered: each pixel's blend fraction
between the old brand and white was solved from its own channels and
re-mixed against the new brand, leaving geometry, alpha and dimensions
byte-identical. Anything that changes the icon _shape_ still needs a real
rasteriser.

Separately, `client-admin/index.html:20` currently hardcodes
`class="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"` on
`<body>`. #348 replaces it with `class="bg-background text-foreground"` so
the body follows the tokens instead of raw Tailwind zinc.

Two more #348 edits ride along with that change:

- `client-admin/src/pwa/manifest.ts:64` sets `background_color: '#ffffff'`,
  and its own comment justifies white by "the app boots onto a white
  surface (index.html's bg-white)" — the very premise #348 removes. Left
  alone, the PWA splash flashes white and then snaps to the `#f8fafc`
  ground. #348 sets it to `#f8fafc`, rewrites that comment, and updates
  the assertion at `client-admin/src/pwa/manifest.test.ts:40`.
- the `@custom-variant dark` line from §3.4.1, so the `dark:` utilities it
  stops relying on in `index.html` are re-wired to `data-theme` for
  everything else before #353 ships a toggle.

---

## 9. What each ticket receives

This table is the contract. If a downstream ticket needs a value that is
not here, that is a gap in this document — reopen #342 rather than
inventing one.

| Ticket                                          | Receives from this document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#343** Two-script type system                 | §2 in full: Anek Latin + Anek Bangla, family name `Biddaloy Sans`, both `unicode-range` strings, `wght` 400–800, `wdth` pinned 100, `font-display: swap`, metric-matched fallback, the 8-step ramp, 45 + 135 = 180 KB budget and the 400–700 relief valve. Also: add `http://localhost:5174/portal` to `lighthouserc.cjs`'s url list (§2), and rewrite the now-stale "Spacing and typography are deliberately absent" comment block in `ui/tailwind.preset.ts` — the type ramp is exactly the "real need" that comment was waiting for                                                                                                                                                                                                                                                                                                                                                                                                            |
| **#344** Palette re-grade                       | §3: brand ramp `#eef1fe` / `#dfe3fd` / `#8f96f4` / `#4a3fd4` / `#3d33b8`; ground↔surface inversion; `dark.brand` → `#8f96f4`; dark `--color-primary-foreground` → `#0f172a` (§3.4); `--color-muted` / `--color-accent` → `neutral-100` in light (§3.3); the `CONTRAST_PAIRS` changes in §3.6 — 3 adds + 2 literal updates, not nine adds; plus §8's `theme-color` and `THEME_COLOR` → `#4a3fd4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **#345** Split border roles                     | §4: `--color-border-subtle` (`#e2e8f0` light / `#334155` dark) and `--color-border-functional` (`#64748b` both); the utility is `border-border-subtle` / `border-border-functional` (§4); the rule that subtle gets no contrast pair. Also: `light.borderSubtle` / `dark.borderSubtle` in the preset and the `roleVarNames` extension in `check-contrast.mjs` (§1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **#346** Elevation scale                        | §5: the three `--shadow-e*` token values, light and dark; the dark border-plus-shadow rule. Also: a `shadows` export in the preset and its drift check (§1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **#347** Motion tokens                          | §7: three durations, two easings, and the exact global reduced-motion rule. Also: a `motion` export in the preset and its drift check (§1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **#348** Token-driven `<body>`                  | §8 in full: `client-admin/index.html:20` → `bg-background text-foreground`; PWA `background_color` → `#f8fafc` plus its comment and `manifest.test.ts:40`; §3.4.1's `@custom-variant dark` line. **Size note:** bigger than its `size-S` label: three files plus a behavioural prerequisite for #353                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **#349** Density modes                          | §6: the full numeric table, the `data-density` CSS-variable mechanism, and the complete per-variant 44 px mapping table. The mechanism is a _rewrite_ of every literal size class to `h-[var(--control-h,…)]` — not a read of a variable that already exists. No prop API change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **#350** Elevation and borders on every surface | §4 + §5, including the six-row shadow mapping table in §5, **plus the `bg-card` migration table in §3.3** (~12 call sites across `ui/src` and `client-admin`, with their tests). **Size note:** materially bigger than the shadow swap its `size-M` label priced — the inversion is invisible without it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **#351** Interactive-state pass                 | §3.2 (`brand-600` / `brand-700` for hover and active), §4 (functional border for focus-adjacent edges), §7 (`--motion-duration-fast`). Also owns two things found during #344's review: the latent white-on-white `bg-secondary` button (§3.3 item 1) — measured 1.00:1 inside a card and 1.03:1 on the ground in light mode, 1.00:1 inside a card in dark mode, with `border border-transparent` supplying no boundary either, so the fix must give the variant both a distinguishable surface and a real border, and making the overlay animations real — `animate-in`/`fade-in-0`/`zoom-in-95` appear 7 times across 5 primitives but **no animation package is installed**, so they compile to nothing and every overlay snaps today. Install `tw-animate-css` (the Tailwind v4 successor to `tailwindcss-animate`), which makes the existing class strings live with zero component edits; the result must honour #347's reduced-motion rule |
| **#352** Empty, loading, error, skeleton states | §3.3 ground/surface (skeletons sit on `surface`, shimmer toward `muted` `#f1f5f9`), §2 `caption` step for helper copy, §7 `--motion-duration-base`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **#353** Expose dark mode                       | §3.4 dark role values, §5 dark shadows plus the border rule, §4 dark border values. Prerequisite: #348's `@custom-variant dark` (§3.4.1) must already be on the branch, or the toggle produces a half-dark UI. Also decide the fate of the dead `--color-sidebar-*` group (§3.3 item 4): wire it up or delete it — nothing renders it today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **#354** Storybook Foundations page             | Every table in this document is the page's content. **No visual-baseline re-pin exists to do**: the repo has no visual-regression harness — no `toHaveScreenshot`, no snapshot directories; that harness is #128 ([8.5.4], still open). If #128 lands before this ticket, re-pin there; otherwise #354's PR carries manual before/after screenshots of the three mockup screens in light and dark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 10. What was left open

Three things are deliberately _not_ decided here, because they can only be
answered by measurement or by real screens:

1. **The measured font subset size.** 45 KB / 135 KB are engineering
   estimates. #343 measures the real `woff2` output and records it. If
   Bangla exceeds 135 KB, narrow `wght` to 400–700 — do not exceed the
   180 KB total silently.
2. **Anek at 13–14 px.** Bengali conjuncts are dense at small sizes. If
   Anek Bangla reads poorly at the `label` and `caption` steps, the
   pre-agreed fallback pairing is **Noto Sans + Noto Sans Bengali**, which
   is the same wiring with different files. Switching costs nothing at
   #343; it costs a lot once #344–#353 have hand-verified every screen
   against the shipped face — and more still once #128's visual-regression
   harness (a separate, still-open epic-8.5 ticket) pins baselines over it.
3. **Anything a mockup reveals.** If a value changes during
   implementation, re-run the contrast formula on it and update this
   document in the same PR. This file, not an issue comment, is the record.
