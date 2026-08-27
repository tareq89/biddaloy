/**
 * [5.5] — the horizontal row of student chips a guardian of more than one
 * child uses to switch between their per-child fee views. Shipped
 * route-local in `client-admin/src/routes/portal/fees.tsx` for [5.3];
 * promoted here unchanged now that a second caller (the portal landing's
 * child cards link at the same `?student=` param) makes it shared
 * surface. The markup is the reviewed 5.3 markup — nothing restyled.
 *
 * Real `Link`s, not a `<select>`: this control *is* the `?student=`
 * search param made visible, so each option is a navigable, bookmarkable
 * URL, the back button walks the choices, and switching is keyboard
 * operable and announced for free — an `<a>` is focusable, activates on
 * Enter, and the active chip carries `aria-current="page"`. Swipe (the
 * `overflow-x-auto` row) is an addition on top, never the only way.
 *
 * **`?student=` contract.** Chips link to `to` with `search={{ student:
 * id }}`. The receiving route is expected to validate that param the way
 * `feesSearchSchema` does: an id the caller cannot see falls back to
 * their first linked student rather than erroring, and the server
 * re-checks the family link on every request regardless — the param
 * never widens access.
 *
 * **Fewer than two items renders nothing.** A guardian of exactly one
 * child must see no switching affordance at all, and that rule belongs in
 * the component rather than only at the call site: it is an accessibility
 * and clarity requirement of the control itself ("no redundant one-item
 * list"), not a layout decision a caller may reasonably differ on.
 * Callers may still gate on top of it; both hold.
 *
 * i18n is prop-driven — `@biddaloy/ui` components never call
 * `useTranslation` (same as `BottomNav`, `EmptyState`, `StatusBadge`), so
 * the caller passes the landmark `label` and pre-formats each item's
 * `meta` line with its own translations.
 */
import { Link } from '@tanstack/react-router';

import { cn } from '../primitives/lib/utils';

export interface StudentPickerItem {
  id: string;
  /** Shown as the chip's primary line — the student's full name. */
  name: string;
  /** Secondary line, already translated and formatted by the caller
   * (e.g. "Class 8 B · Roll 14"). */
  meta: string;
}

export interface StudentPickerProps {
  /** Accessible name for the `<nav>` landmark — a page can hold more than
   * one, so a screen-reader user needs this to tell them apart. */
  label: string;
  items: readonly StudentPickerItem[];
  /** Which item reads as current. */
  selectedId: string;
  /** Route the chips link to; the student id rides in `?student=`. */
  to: string;
  className?: string;
}

export function StudentPicker({ label, items, selectedId, to, className }: StudentPickerProps) {
  // Nothing to choose between — see this file's header comment.
  if (items.length < 2) return null;

  return (
    <nav
      aria-label={label}
      data-slot="student-picker"
      className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1', className)}
    >
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <Link
            key={item.id}
            to={to}
            search={{ student: item.id }}
            aria-current={active ? 'page' : undefined}
            // `min-h-11` is 44px — the portal's minimum touch target.
            className={`flex min-h-11 flex-shrink-0 flex-col justify-center gap-0.5 rounded-lg border px-3 py-1.5 no-underline ${
              active ? 'border-primary bg-primary/10' : 'border-border bg-background'
            }`}
          >
            <span className="text-sm font-semibold">{item.name}</span>
            <span className="text-[11px] text-muted-foreground">{item.meta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
