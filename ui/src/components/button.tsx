/**
 * The one wrapper around `primitives/button` — see `primitives/README.md`
 * for why nothing imports that file directly. Owns two guarantees the
 * primitive alone doesn't give you:
 *
 * - **Loading is a real busy state**, not just a disabled button with a
 *   spinner glued on: `aria-busy` is set, the button is disabled so a
 *   double-click can't fire twice, and a visually-hidden, `aria-live="polite"`
 *   "Loading" text node is added so a screen reader announces the state
 *   change even though the visible label (intentionally) doesn't change.
 *   Skipped for `asChild` — it merges onto a single child element, and the
 *   extra nodes would break that merge; `asChild` callers still get
 *   `aria-busy`/`disabled`, just not the visual additions.
 * - **An icon-only button cannot ship with no accessible name.** `iconOnly`
 *   and `aria-label` are a discriminated union below, not a runtime check —
 *   omitting `aria-label` while `iconOnly` is `true` is a type error, not a
 *   lint warning or an axe failure discovered later.
 *
 * "Loading" is a literal string, not yet run through i18n — real i18next
 * wiring is [8.7.1]; every wrapper in this epic carries this same gap until
 * that lands (see `.storybook/locale.tsx`'s comment for the same tradeoff
 * on the Storybook side).
 */
import type { VariantProps } from 'class-variance-authority';
import { Loader2Icon } from 'lucide-react';
import * as React from 'react';

import { Button as ButtonPrimitive, type buttonVariants } from '../primitives/button';

type ButtonBaseProps = Omit<React.ComponentProps<typeof ButtonPrimitive>, 'aria-label'> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, sets `aria-busy`, and disables the button. Visible
     * label stays the same — only the busy state and disabled-ness change. */
    loading?: boolean;
  };

export type ButtonProps =
  | (ButtonBaseProps & { iconOnly?: false; 'aria-label'?: string })
  | (ButtonBaseProps & { iconOnly: true; 'aria-label': string });

export function Button({ loading = false, iconOnly, disabled, children, ...props }: ButtonProps) {
  // `asChild` merges onto a single child element (Radix `Slot`, which
  // requires `React.Children.count(children) === 1` — a falsy expression
  // like `{loading && <Spinner />}` still counts as a child slot even when
  // it renders nothing, so it can't sit alongside `children` here). Callers
  // using `asChild` own their one child already, so loading only adds the
  // busy/disabled semantics for them, not the extra visual nodes.
  const content = props.asChild ? (
    children
  ) : (
    <>
      {loading && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {children}
      {loading && (
        <span className="sr-only" aria-live="polite">
          {' '}
          Loading
        </span>
      )}
    </>
  );

  return (
    <ButtonPrimitive
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      data-icon-only={iconOnly || undefined}
      {...props}
    >
      {content}
    </ButtonPrimitive>
  );
}
