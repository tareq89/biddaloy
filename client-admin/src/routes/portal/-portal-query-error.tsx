/** A failed portal query: a 403 is "not for you" (AccessDeniedState, no retry), anything else is a retryable error. */
import { ApiError } from '@biddaloy/ui/api';
import { AccessDeniedState, ErrorState } from '@biddaloy/ui/components';

export function PortalQueryError({
  error,
  message,
  retryLabel,
  onRetry,
}: {
  error: unknown;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  if (error instanceof ApiError && error.statusCode === 403) return <AccessDeniedState />;
  return <ErrorState message={message} retryLabel={retryLabel} onRetry={onRetry} />;
}
