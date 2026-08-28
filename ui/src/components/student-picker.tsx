/**
 * [5.5] — the row of chips a guardian of more than one child uses to
 * switch between their per-child fee views. Shipped route-local in
 * `client-admin/src/routes/portal/fees.tsx` for [5.3]; promoted here
 * unchanged once the portal landing became a second caller. The markup is
 * the reviewed 5.3 markup — nothing restyled.
 *
 * Renders `null` below two items: a guardian of exactly one child must see
 * no switching affordance at all, and that belongs to the control rather
 * than to each call site.
 *
 * Chips are real `Link`s to `to` with `search={{ student: id }}`, which is
 * what makes switching keyboard-operable and announced without extra ARIA.
 * i18n is prop-driven — `@biddaloy/ui` components never call
 * `useTranslation` (same as `BottomNav`, `EmptyState`, `StatusBadge`).
 *
 * The navigation flow this belongs to, the `?student=` contract, and why
 * that param never widens access are documented in
 * `docs/architecture/06-frontend-architecture.md` ("How a guardian moves
 * between their children").
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
              active ? 'border-primary bg-primary/10' : 'border-border bg-card'
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
