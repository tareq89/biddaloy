import { isOfflineRouteError } from '@biddaloy/ui/components';
import { i18n } from '@biddaloy/ui/i18n';

/**
 * A route loader's `.catch()` handler: swallows the rejection so the route
 * still commits and its own component can surface the failure in place —
 * [8.14.5]'s rule, so a list shows `DataTable`'s error row rather than
 * handing the whole screen to the router's generic error boundary.
 *
 * With one exception: being offline, which is rethrown. The boundary's
 * offline fork (`RouteStatusState`) exists precisely for "you have no
 * connection" and is strictly more useful there than an in-table "couldn't
 * load" — it names the cause, offers a retry, and says what is still
 * readable. [8.12.6]'s PWA contract (`e2e/pwa/offline-navigation.spec.ts`,
 * "data that was never cached falls into the offline state") is that
 * guarantee, and catching unconditionally silently broke it: a filter
 * typed while offline rendered a generic error that never mentioned the
 * network.
 *
 * The offline test is `isOfflineRouteError`, the boundary's own
 * classifier, so this can never rethrow something the boundary would then
 * render as a plain error.
 *
 * ```ts
 * loader: ({ context: { queryClient }, deps }) =>
 *   Promise.all([
 *     queryClient.ensureQueryData(studentsQueryOptions(deps)).catch(swallowUnlessOffline),
 *     loadRouteNamespaces('students', 'common'),
 *   ]),
 * ```
 */
export function swallowUnlessOffline(error: unknown): undefined {
  if (isOfflineRouteError(error)) throw error;
  return undefined;
}

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
