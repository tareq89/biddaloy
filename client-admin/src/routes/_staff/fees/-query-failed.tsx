import { ApiError } from '@biddaloy/ui/api';
import { AccessDeniedState, ErrorState } from '@biddaloy/ui/components';

/** A failed read: 403 says "no permission", anything else offers Retry. `message` is the page's own fixed sentence (Rule 23: never the server text). */
export function QueryFailed({
  error,
  message,
  onRetry,
  retryLabel,
}: {
  error: unknown;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  if (error instanceof ApiError && error.statusCode === 403) return <AccessDeniedState />;
  return (
    <ErrorState
      message={message}
      onRetry={onRetry}
      {...(retryLabel !== undefined ? { retryLabel } : {})}
    />
  );
}
