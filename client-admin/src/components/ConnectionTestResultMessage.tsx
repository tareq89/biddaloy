import { MutationErrorMessage } from './MutationErrorMessage';

/**
 * Every provider section renders `useTestSchoolConnection`'s result the
 * same way — a pass/fail `<p role="status">` for the mutation resolving,
 * plus a `MutationErrorMessage` for the mutation itself failing (network
 * error, 401, 500). The second half was missing from every section
 * before this component existed: only `testConnection.data` was ever
 * read, so a failed *request* (as opposed to a request that resolved
 * with `{ success: false }`) showed nothing at all.
 */
export interface ConnectionTestResultMessageProps {
  data: { success: boolean; message: string } | undefined;
  isError: boolean;
  error: unknown;
}

export function ConnectionTestResultMessage({
  data,
  isError,
  error,
}: ConnectionTestResultMessageProps) {
  return (
    <>
      {data && (
        <p
          role="status"
          className={data.success ? 'text-sm text-emerald-700' : 'text-sm text-destructive'}
        >
          {data.message}
        </p>
      )}
      {isError && <MutationErrorMessage error={error} />}
    </>
  );
}
