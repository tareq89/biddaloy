import type { BreadcrumbItem } from '@biddaloy/ui/components';
import type { AcademicYear, Class, Guardian, Student } from '@biddaloy/ui/hooks';
import {
  academicYearQueryOptions,
  classQueryOptions,
  guardianQueryOptions,
  studentQueryOptions,
  useEntityLabel,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { useMatches } from '@tanstack/react-router';

import { STAFF_NAV_ITEMS, type StaffNavLabel } from './nav-tree';
import { ROUTE_CRUMBS, type RouteCrumbs } from './route-crumbs';

/**
 * [30.3.3] wires [30.3.1]'s `ROUTE_CRUMBS` map and [30.3.2]'s
 * `Breadcrumbs` component into the two shells (`_staff.tsx`, `portal.tsx`)
 * — the piece both earlier tickets built but neither wired in.
 *
 * `ROUTE_CRUMBS` is keyed by the *leaf* route id and stores that leaf's
 * whole trail already, so resolving it is one lookup by
 * `matches[matches.length - 1].routeId` — the exact pattern `_staff.tsx`
 * already uses for `STAFF_ROUTE_PERMISSIONS` (see that file's own
 * `useMatches()` call) and `use-route-focus.ts` doesn't need to repeat
 * here.
 *
 * A `dynamic: 'entity'` segment's *label* (e.g. `{ entity: 'student' }`)
 * is only ever a generic noun — it is not the instance's name. The real
 * display text for that segment comes from `ENTITY_RESOLVERS` below,
 * which reads the same react-query cache the page's own detail route
 * already warmed via its loader's `ensureQueryData` call, so this hook
 * never fires its own network request. `enabled: false` keeps the read
 * reactive (it re-renders if the cached entity is later updated, e.g. by
 * an edit) without ever triggering a fetch of its own.
 *
 * Only entities with a confirmed, simple single-string display field are
 * registered (student, guardian, class, academic year). Staff members,
 * invoices, payments, attendance sections, fee schedules and reminder
 * batches don't have an equally simple "name" field wired to a shared
 * query-options export the same way, so their dynamic crumb stays as the
 * raw id — same as this hook's designed "still loading" fallback, just
 * permanent for those routes. This is a deliberate scope line for this
 * wave-close ticket, not an oversight; widening it is separate follow-up
 * work, not silently expanded here.
 */

type EntityResolver<TData> = {
  // Deliberately untyped beyond `queryKey` — each entry's real
  // `queryOptions` function (`studentQueryOptions`, etc.) has its own
  // precise `UseQueryOptions<TData>` shape; the union of all of them
  // isn't worth expressing here, since `useResolvedEntityName` only ever
  // spreads a single one into `useQuery` and reads its `data` back
  // through this resolver's own `getName`.
  queryOptions: (id: string) => { queryKey: QueryKey } & Record<string, unknown>;
  getName: (data: TData) => string;
};

// Deliberate type erasure: each entry's real `TData` (`Student`,
// `Guardian`, …) is already pinned by its own `getName` below; the map
// itself just needs to hold heterogeneous entries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENTITY_RESOLVERS: Record<string, EntityResolver<any>> = {
  student: {
    queryOptions: studentQueryOptions,
    getName: (data: Student) => data.full_name,
  },
  guardian: {
    queryOptions: guardianQueryOptions,
    getName: (data: Guardian) => data.full_name,
  },
  class: {
    queryOptions: classQueryOptions,
    getName: (data: Class) => data.name,
  },
  academicYear: {
    queryOptions: academicYearQueryOptions,
    getName: (data: AcademicYear) => data.name,
  },
};

/** List-page `to` for a segment's own label, read from the same
 * `STAFF_NAV_ITEMS` data `_staff.tsx` renders the sidebar from, so a
 * breadcrumb link and its matching nav item can never point two
 * different places for the same entity. */
function findNavPath(label: StaffNavLabel): string | undefined {
  const sameLabel = (a: StaffNavLabel, b: StaffNavLabel): boolean =>
    ('entity' in a && 'entity' in b && a.entity === b.entity) ||
    ('key' in a && 'key' in b && a.key === b.key);
  const match = Object.values(STAFF_NAV_ITEMS).find((item) => sameLabel(item.label, label));
  return match?.to;
}

function useResolvedEntityName(
  entityKey: string | undefined,
  id: string | undefined,
): string | undefined {
  const resolver = entityKey ? ENTITY_RESOLVERS[entityKey] : undefined;
  const active = resolver !== undefined && id !== undefined;
  const options = active
    ? resolver.queryOptions(id)
    : { queryKey: ['breadcrumb-inactive'] as QueryKey, queryFn: () => Promise.resolve(undefined) };
  // `enabled: false` matches this hook's whole point (see the module
  // comment): read whatever's already cached, never fetch on our own —
  // the query type varies per entity, so `useQuery` can't infer `TData`
  // here the way a single fixed call site would.
  const query = useQuery({ ...options, enabled: false } as UseQueryOptions<unknown>);
  if (!active || query.data === undefined) return undefined;
  return resolver.getName(query.data);
}

export interface UseBreadcrumbsResult {
  /** Ready for `Breadcrumbs`' `items` prop — empty for any route
   * `ROUTE_CRUMBS` marks `null` (no chrome, e.g. the guardian portal's
   * placeholder pages), so `Breadcrumbs` itself renders nothing there. */
  items: BreadcrumbItem[];
  /** Reversed trail joined with ` · `, e.g. `Fees · Rahim Uddin ·
   * Biddaloy` — the tab title for routes that do have a trail.
   * `undefined` when there is no trail, so the caller can leave
   * `document.title` to whatever already owns it for that route. */
  title: string | undefined;
}

export function useBreadcrumbs(appName: string): UseBreadcrumbsResult {
  const { t } = useTranslation('nav');
  const matches = useMatches();
  const leafMatch = matches[matches.length - 1];
  const leafRouteId = leafMatch?.routeId;
  const entry = leafRouteId ? ROUTE_CRUMBS[leafRouteId] : undefined;
  const segments: RouteCrumbs = Array.isArray(entry) ? entry : [];

  const lastIndex = segments.length - 1;
  const dynamicIndex = segments.findIndex((segment) => segment.dynamic === 'entity');
  const dynamicSegment = dynamicIndex >= 0 ? segments[dynamicIndex] : undefined;
  // Exactly one dynamic param on any leaf that has one — `route-crumbs.ts`
  // never nests two dynamic segments in the same trail.
  const dynamicId = dynamicSegment && leafMatch ? Object.values(leafMatch.params)[0] : undefined;
  const dynamicEntityKey =
    dynamicSegment && 'entity' in dynamicSegment.label ? dynamicSegment.label.entity : undefined;

  // Same plural count `_staff.tsx`'s own `entityLabels` map uses for
  // these nouns in the sidebar — a breadcrumb list segment is the same
  // "Students" collection link, not a fresh string.
  const studentLabel = useEntityLabel('student', { count: 2 });
  const guardianLabel = useEntityLabel('guardian', { count: 2 });
  const staffLabel = useEntityLabel('staff', { count: 2 });
  const classLabel = useEntityLabel('class', { count: 2 });
  const academicYearLabel = useEntityLabel('academicYear', { count: 2 });
  const invoiceLabel = useEntityLabel('invoice', { count: 2 });
  const entityLabels: Record<string, string> = {
    student: studentLabel,
    guardian: guardianLabel,
    staff: staffLabel,
    class: classLabel,
    academicYear: academicYearLabel,
    invoice: invoiceLabel,
  };

  const resolvedName = useResolvedEntityName(dynamicEntityKey, dynamicId);

  if (segments.length === 0) {
    return { items: [], title: undefined };
  }

  const items: BreadcrumbItem[] = segments.map((segment, index) => {
    const isLast = index === lastIndex;
    if (segment.dynamic === 'entity') {
      const label = resolvedName ?? dynamicId ?? '';
      const to = !isLast && dynamicId ? deriveEntityPath(segment.label, dynamicId) : undefined;
      return to ? { label, to } : { label };
    }
    const label =
      'entity' in segment.label
        ? (entityLabels[segment.label.entity] ?? '')
        : t(`items.${segment.label.key}`);
    const to = !isLast ? findNavPath(segment.label) : undefined;
    return to ? { label, to } : { label };
  });

  const title = [...items]
    .reverse()
    .map((item) => item.label)
    .concat(appName)
    .join(' · ');

  return { items, title };
}

function deriveEntityPath(label: StaffNavLabel, id: string): string | undefined {
  const listPath = findNavPath(label);
  return listPath ? `${listPath}/${id}` : undefined;
}
