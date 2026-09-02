import { SkeletonFieldList, SkeletonTable, SkeletonText } from './skeleton';

/**
 * [8.14.5]: marks a route's pending UI in the DOM so `useRouteFocus`
 * (`../hooks/use-route-focus.ts`) can tell "the skeleton is still up"
 * apart from "the real page mounted" and keep deferring focus instead of
 * landing it on a skeleton that's about to be replaced. See that hook's
 * own comment on the retry-counter branch for the full reasoning — this
 * is the marker it's watching for, not a styling hook.
 */
export const ROUTE_PENDING_ATTR = 'data-route-pending';

export type RoutePendingVariant = 'list' | 'detail' | 'form';

export interface RoutePendingProps {
  /** Shape of the underlying page: a paginated table, a single record's
   * fields, or a form. Selects which `Skeleton*` primitive composition
   * to render. Defaults to `'detail'` — the shape closest to a generic
   * page, used by `main.tsx`'s router-wide `defaultPendingComponent`
   * fallback before a route's own `pendingComponent` override narrows
   * it. */
  variant?: RoutePendingVariant;
  /** Visually-hidden text for screen readers/AT — translated by the
   * caller (`nav.json`'s `routePending.label`), never hard-coded here,
   * since `@biddaloy/ui` stays translation-agnostic. */
  label: string;
}

function VariantBody({ variant }: { variant: RoutePendingVariant }) {
  switch (variant) {
    case 'list':
      return (
        <>
          <SkeletonText lines={1} className="w-48" />
          <SkeletonTable rows={6} columns={5} />
        </>
      );
    case 'form':
      return (
        <>
          <SkeletonText lines={1} className="w-48" />
          <SkeletonFieldList fields={4} />
        </>
      );
    case 'detail':
    default:
      return (
        <>
          <SkeletonText lines={1} className="w-48" />
          <SkeletonFieldList fields={6} />
        </>
      );
  }
}

/**
 * Router-wide pending fallback ([8.9.8]'s sibling for the "never renders
 * `null` while a loader is in flight" acceptance criterion). Wired in as
 * `defaultPendingComponent` (`client-admin/src/main.tsx`) and overridden
 * per-route with a specific `variant` where the plan's per-route table
 * calls for one — see `client-admin/src/route-loaders.ts`'s recipe
 * comment for how a route wires its own `pendingComponent`.
 */
export function RoutePending({ variant = 'detail', label }: RoutePendingProps) {
  return (
    <div
      {...{ [ROUTE_PENDING_ATTR]: true }}
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="space-y-4"
    >
      <span className="sr-only">{label}</span>
      <VariantBody variant={variant} />
    </div>
  );
}
