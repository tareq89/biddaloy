import { i18n } from '@biddaloy/ui/i18n';

/**
 * [8.14.5]: preloads the i18n namespace(s) a route's subtree renders, so
 * a first-visit navigation never suspends into `I18nProvider`'s `null`
 * Suspense fallback (`@biddaloy/ui/i18n/locale-provider.tsx`) — that
 * fallback is what AC 5 ("first visit to a route never blanks on
 * namespace loading") is about.
 *
 * Pair this with `queryClient.ensureQueryData(...)` inside a single
 * `Promise.all` in a route's `loader`, so both the translated strings and
 * the data land before the route commits:
 *
 * ```ts
 * export const Route = createFileRoute('/_staff/students/$studentId')({
 *   loader: ({ context: { queryClient }, params }) =>
 *     Promise.all([
 *       queryClient.ensureQueryData(studentQueryOptions(params.studentId)),
 *       loadRouteNamespaces('students', 'common'),
 *     ]),
 *   pendingComponent: StudentDetailPending,
 *   component: StudentDetailPage,
 * });
 * ```
 *
 * A route with no primary query (a create form, say) just calls this on
 * its own: `loader: () => loadRouteNamespaces('studentImport')`.
 *
 * This function is deliberately a thin one-liner around `i18n
 * .loadNamespaces` — the whole point is that every route's `loader` has
 * one greppable call site to check against the per-route namespace table
 * in the plan, not a bespoke per-route i18n-loading pattern.
 */
export function loadRouteNamespaces(...namespaces: string[]): Promise<unknown> {
  return i18n.loadNamespaces(namespaces);
}
