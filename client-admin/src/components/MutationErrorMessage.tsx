/**
 * `useMutation`'s `error` is typed `TError | null` where `TError` defaults
 * to `unknown` for every hook in `school-settings.ts` — passing
 * `shouldRetryQuery` (typed `(failureCount, error: unknown) => boolean`)
 * as the `retry` option widens `TError` to `unknown` for that call, since
 * TS infers it from the narrowest type every option's callback accepts.
 * A real `Error` (what `apiClient`'s interceptor always throws — see
 * `api/errors.ts`) narrows cleanly via `instanceof`; anything else falls
 * back to `String(error)` rather than a type-error at the call site.
 */
export function MutationErrorMessage({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
