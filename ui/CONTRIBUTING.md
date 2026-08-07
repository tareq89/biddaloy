# Contributing to `@beton-boi/ui`

Three SPAs pull on this one package. Nothing here stops that from eroding
except this document being where a contributor actually meets the rules —
not a wiki page nobody reads before their first PR. If something here and
the code disagree, the code wins; open a PR fixing whichever one is wrong.

## The wrapper rule

shadcn/ui is a code generator, not a dependency — its CLI copies source
into `src/primitives/`. That output is **vendored**: regenerate it, never
hand-edit it (see `src/primitives/README.md` for the narrow, documented
exceptions — a fix `--overwrite` would silently discard, always with a
comment explaining why).

Every primitive an SPA needs gets **exactly one** wrapper in
`src/components/`, and the wrapper is the only public surface — no SPA
imports `radix-ui` or `src/primitives/` directly (`yarn check:exports`
enforces this from this package's side; a consuming SPA's own lint config
enforces it from the other side, see [8.2.3]).

The wrapper owns:

- **i18n** of built-in strings — no English literal reaches a screen once
  [8.7.1]'s i18next wiring lands. Until then, a literal string is fine
  _if the file says so_ — see "i18n rules" below.
- **Accessibility defaults** — labels, `aria-*`, focus behaviour,
  required-field semantics that don't need a call site to think about
  them.
- **Design tokens** and the size/variant vocabulary — see "Token usage"
  below.
- **Project semantics** — `MoneyInput` knows lakh/crore grouping;
  `PhoneInput` knows the configured region's phone pattern; `StatusBadge`
  never encodes status in colour alone. A primitive has no way to know
  any of this; the wrapper is where it becomes true for every SPA at
  once.

### A pure pass-through wrapper requires justification

Stated as plainly as the rest of this rule: a wrapper that changes
nothing about the primitive it wraps — no default, no `aria-*`, no
token, no semantics — needs its header comment to say why the seam is
still worth having (the worked `Checkbox` example below is exactly this
case). A pass-through with no such comment is what a reviewer should
flag, not wave through because "it follows the pattern."

The honest tension: two layers make a pure pass-through _possible_, and
under deadline pressure it's tempting to add a wrapper file just to
satisfy the three-file rule below without actually deciding what the
wrapper is for. Don't. The boundary is still worth holding even for a
thin wrapper — the moment one SPA needs a custom variant, having the
seam already there makes it a one-file change instead of a three-app
migration — but "the seam might matter later" is the _reason the
boundary exists_, not a substitute for the wrapper doing something now.
If you can't say what a wrapper adds beyond "SPAs don't import Radix
directly," say that explicitly in the file's own header comment (several
existing wrappers do — `input.tsx`, `checkbox.tsx`) so the next
contributor doesn't wonder whether something was forgotten.

## The three-file requirement

Every component ships exactly three files, same base name:

```text
component-name.tsx           # the component
component-name.stories.tsx   # Storybook — every meaningful visual state
component-name.test.tsx      # vitest + Testing Library
```

This applies to every public component this package exports — a new one,
or an existing one whose behaviour actually changed. It doesn't mean a
one-line bug fix in an existing wrapper needs a story/test rewrite it
gains nothing from; use judgement, and say in the PR why a file wasn't
touched if that's not obvious from the diff.

**`component-name.tsx`** — the implementation. A wrapper composing more
than one Radix primitive (`Dialog`, `Select`, `Menu`) still ships as one
file with multiple named exports, not one file per sub-part — see any of
those three for the pattern.

**`component-name.stories.tsx`** — covers every state a caller can put
the component in: default, loading, empty, error, disabled, and RTL, at
minimum. Not every component has all six as a _distinct_ state — a
`Tooltip` has no loading/error/disabled state separate from "shown or
not." When a category doesn't apply, say so in a comment at the top of
the story file rather than silently omitting it; a missing category with
no explanation reads as an oversight in review, an explained one doesn't.
The RTL story wraps in `dir="rtl"` (via `.storybook/rtl-decorator.tsx`)
rather than switching locale — neither of this package's two supported
locales (`en`, `bn`) is actually RTL yet, but every component still needs
its own layout proven to survive a bidi flip.

**`component-name.test.tsx`** — real behavioural coverage, not coverage
for its own sake. At minimum:

- Renders with an accessible name and is `axe` clean
  (`await expect(container).toHaveNoViolations()` — registered globally,
  see this package's own [README](README.md#accessibility)). For a bare
  control whose accessible name is intentionally the caller's job (see
  `Checkbox` below), the test provides that context itself (an
  `aria-label`, say) rather than asserting the component is accessible
  with none — that's what proves the wrapper doesn't silently supply
  what it says it doesn't own, not a gap in the requirement.
- Keyboard-operable — `expectKeyboardOperable`/`expectTabOrder` from
  `@beton-boi/ui/test` for the common cases; a hand-rolled roving-tabindex
  widget (see `DataTable`, `Calendar` in `date-picker.tsx`) needs its own
  arrow-key/Home/End assertions instead.
- Every prop-driven behavioural branch this component actually adds over
  its primitive — not "does Radix's own Dialog trap focus" (trust Radix,
  it's tested upstream), but "does _this_ composition still trap it" if
  the wrapper changes how children are passed. `dialog.test.tsx` is the
  worked example: it exercises the trap/Esc/focus-return chain end to
  end specifically because a wrapper _could_ silently break it, not
  because Radix might.

Target 95% statement/branch coverage on the file you're adding — the
repo's aggregate coverage floor (`vitest.config.ts`) is lower globally
because it also covers modules written before this bar existed; a new
file should clear the higher bar, not the historical average. Nothing
enforces this per file today (`yarn test:frontend:coverage` reports the
number but doesn't gate on it) — it's a review target, checked by
reading the coverage report for the specific file, same as the
colour-alone and icon-name rules below.

## Accessibility expectations

Covered in depth in this package's own [`README.md`](README.md#accessibility)
— link there rather than duplicating it here. In short: `toHaveNoViolations`
is registered globally, `expectKeyboardOperable`/`expectTabOrder` cover
the common interaction patterns, and `color-contrast` is disabled under
jsdom (no real paint engine) — verified instead by `check:contrast`
against the token pairs in `tailwind.preset.ts`, not per-component.

Two rules with no test-runner enforcement, so they're enforced by review
instead:

- **Never convey state by colour alone.** `StatusBadge` is the reference:
  colour **and** text **and** a distinct icon shape, verified with a
  `Greyscale` story (`filter: grayscale(1)`) proving the icon carries the
  meaning on its own.
- **An icon-only interactive element needs an accessible name the type
  system can't let you skip.** `Button`'s `iconOnly`/`aria-label`
  discriminated union is the pattern — omitting `aria-label` while
  `iconOnly` is `true` is a compile error, not a lint warning discovered
  in a later audit.

## Token usage

Reach for a semantic role token (`bg-muted`, `text-destructive`,
`text-status-paid-fg`) before a raw scale value (`bg-neutral-100`). Raw
scale entries in `tailwind.preset.ts` keep a fixed _value_ across themes;
role tokens keep a fixed _meaning_ — a component built from roles switches
light/dark for free, one built from raw scale values doesn't, and can end
up with a light-on-light mismatch if only one side of a pair gets swapped
later.

`--color-status-*` tokens (`tailwind.preset.ts`'s `status` export,
mirrored in `src/styles/globals.css`'s `@theme` block) are the one pair of
files `check:contrast` verifies stay in sync by name and WCAG 2.2 ratio —
if you add a new semantic colour, add it to _both_ files or that check
fails, on purpose.

Never a literal hex value in a component file. If the token you need
doesn't exist yet, add it to `tailwind.preset.ts` (and the CSS mirror) in
the same PR, with the same contrast verification every existing token
has — not a one-off value that bypasses the check.

## i18n rules

[8.7.1] (i18next setup) hasn't landed yet, so every wrapper in this epic
currently ships with plain English literals for anything it wouldn't
otherwise need — `Button`'s "Loading" text, `EmptyState`'s default copy,
and so on. That's an accepted, temporary gap, not silent non-compliance:
**every file with a literal user-facing string says so in a comment**,
naming [8.7.1] as the ticket that replaces it. Follow that pattern for any
new component: don't invent your own translation shim, and don't leave
the literal unexplained either.

Once [8.7.1] lands, no new component should introduce a raw string —
[8.7.4]/[8.7.5]/[8.2.7] add lint enforcement for exactly that, scoped to
consuming SPAs first (`ui`'s own wrapper layer is where translation keys
originate, so it's necessarily still full of literal fallback text by
design — the lint rule targets call sites, not this package).

`MoneyInput`/`PhoneInput`/date formatting never call `Intl`/`Number`/
`Date` formatting methods directly — every formatter lives in `src/utils`
(`formatCurrency`, `formatPhone`, `formatDate`, ...) and takes a
`RegionConfig` explicitly, so currency grouping, numerals and phone
patterns are never hardcoded at a call site. See `src/utils/region-config.ts`'s
own header comment for why that file is a narrow stand-in for [8.7.2]'s
real `RegionConfig`, not the full interface yet.

## `ui` versus local to one SPA

Add it here when **two or more SPAs need it, or one SPA's need is
generic enough that a second app needing the same thing is a matter of
when, not if** — a `MoneyInput` is inherently shared (every school app
handles money the same way); a widget specific to `client-admin`'s bulk
CSV importer probably isn't, at least not until `client-teacher` or
`client-student` also needs bulk import.

Signs it belongs here:

- It wraps a shadcn/Radix primitive (the wrapper rule applies to it by
  definition).
- It composes existing `ui` components/hooks in a way more than one
  screen would reasonably want (a shell, a domain-agnostic layout
  pattern).
- Getting the accessibility/i18n/formatting right is non-trivial enough
  that duplicating it per app risks the three apps drifting apart (exactly
  what this whole epic exists to prevent).

Signs it belongs local to the SPA instead:

- It's tied to one app's specific business flow with no obvious reuse
  (a wizard step sequence specific to one enrollment form, say) — compose
  it from `ui`'s shells/components, but keep the composition itself local.
- It would need a prop or variant that only makes sense for one app's
  design, with no real path to a second app wanting the same thing.
- You're not sure yet. Build it locally first; promoting a
  proven-useful local component into `ui` later is a low-risk move (move
  the file, add stories/tests to the three-file bar, update the one call
  site's import). Promoting something into `ui` and then walking it back
  once a second app's needs turn out to be different is the expensive
  direction — prefer being late to `ui`, not early.

## Worked example: adding a shadcn primitive and wrapping it

Walking through what `checkbox.tsx` actually was, start to finish — the
same four steps for any new primitive.

**1. Vendor the primitive.** From `ui/`:

```bash
npx shadcn add checkbox
```

This writes `src/primitives/checkbox.tsx`, generated against
`components.json`'s `radix-nova` style and this package's own token
names. Check `git diff` — if the CLI's output uses `@/primitives/...`
alias imports (it usually does, per `components.json`'s `aliases`
block), relative-ify them before committing: `@/primitives/lib/utils` →
`./lib/utils`. That alias only resolves inside `ui`'s own tooling
(`tsconfig.json`, `vitest.config.ts`, Storybook's `main.ts`) — the moment
a file using it gets bundled into `client-admin`/`client-student`, it
hits _that app's_ own `@` alias instead (pointing at the app's own
`src/`), and the build fails with "module not found." See
`src/primitives/README.md`'s "Regenerating" section for the full story —
this bit `client-admin`'s build the first time a real wrapper actually
imported a primitive.

Also run `yarn lint` — shadcn's own import ordering rarely matches this
repo's `import/order` rule; `npx eslint . --fix` from `ui/` fixes it
mechanically (formatting only, verify nothing behavioural changed).

**2. Write the wrapper.** `src/components/checkbox.tsx` — decide what
this wrapper actually owns before writing it. For `Checkbox`, the honest
answer was: not much yet. It's a bare control; a real accessible name
(`aria-label` or an associated `<label>`) is the caller's job until
`FormField` ([8.6.3]) composes it into a real labelled field. The
wrapper's own header comment says exactly that, rather than pretending
there's more going on:

```tsx
/**
 * The one wrapper around `primitives/checkbox`. Like `Input`, this is the
 * bare control — an accessible name (`aria-label` or an associated
 * `<label>`) is the caller's responsibility until `FormField` ([8.6.3])
 * composes this with a real label element.
 */
import * as React from 'react';

import { Checkbox as CheckboxPrimitive } from '../primitives/checkbox';

export type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive>;

export function Checkbox(props: CheckboxProps) {
  return <CheckboxPrimitive {...props} />;
}
```

This is close to the pure-pass-through line above — it's justified
because the _composed_ wrapper (`FormField` + `Checkbox`) is where the
real guarantee lands, and every SPA already goes through this file
rather than `primitives/checkbox` directly, which is what makes that
later composition a one-file change instead of a three-app one.

**3. Write the stories.** `src/components/checkbox.stories.tsx` — default,
checked, indeterminate (stands in for "empty" — the closest analog a
checkbox has to neither-set-nor-unset), disabled, invalid (stands in for
"error"), RTL. A comment at the top notes there's no "loading" story:
a checkbox has no loading state of its own distinct from `disabled`.

**4. Write the tests.** `src/components/checkbox.test.tsx` — renders and
is axe-clean _when given an accessible name_ (proving the wrapper doesn't
silently fix what it explicitly says is the caller's job), toggles on
click, toggles on Space when focused. Export it from the barrel
(`src/components/index.ts`), then run `yarn workspace @beton-boi/ui lint`
and `yarn test:frontend:coverage` from the repo root — not just `ui`'s own
`yarn test`, since the root run is what catches an alias that only breaks
once bundled into a consuming app, per step 1.

## PR checklist

Referenced from [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)
for any PR touching `ui/`:

- [ ] Every new/changed component ships all three files (`.tsx` +
      `.stories.tsx` + `.test.tsx`), same base name.
- [ ] The wrapper does more than pass props through — or, if it
      genuinely doesn't yet, its header comment says so and says why the
      seam is still worth having (see "The wrapper rule" above).
- [ ] No SPA-side file imports `radix-ui` or reaches into
      `@beton-boi/ui/src/primitives` — `check:exports` passes.
- [ ] Every story file covers default/loading/empty/error/disabled/RTL,
      or explains in a comment why a category doesn't apply.
- [ ] `await expect(container).toHaveNoViolations()` passes for every
      meaningful state, including error/invalid states.
- [ ] Keyboard-operable — `expectKeyboardOperable`/`expectTabOrder`, or a
      hand-rolled arrow-key/Home/End test for a custom-widget pattern.
- [ ] No hardcoded colour value — role tokens from `tailwind.preset.ts`
      only; a new token is added to both `tailwind.preset.ts` and
      `src/styles/globals.css`'s `@theme` block, and `check:contrast`
      passes.
- [ ] Any new user-facing literal string has a comment naming [8.7.1] as
      what eventually replaces it.
- [ ] `yarn workspace @beton-boi/ui lint` passes.
- [ ] `yarn test:frontend:coverage` (run from the **repo root**, not just
      `ui/`) passes — this is what catches a primitive-alias import that
      only breaks once bundled into `client-admin`/`client-student`.
- [ ] `npx storybook build` (from `ui/`) succeeds.
