import { useNavigate, useSearch } from '@tanstack/react-router';
import * as React from 'react';

/**
 * Open/close state for a dialog the Ctrl+K palette lands on with a one-shot
 * search flag (`?new=1`). Opens when the flag is `1` and `allowed` (the same
 * permission that shows the page's own button), also when the page is already
 * mounted, and clears only that flag on close so list filters survive.
 */
export function useLandingFlag(key: string, allowed: boolean) {
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigate = useNavigate();
  const flagged = allowed && String(search[key]) === '1';
  const [open, setOpen] = React.useState(flagged);

  React.useEffect(() => {
    if (flagged) setOpen(true);
  }, [flagged]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && search[key] !== undefined) {
      void navigate({
        search: ((prev: Record<string, unknown>) => ({ ...prev, [key]: undefined })) as never,
        replace: true,
      });
    }
  };
  return [open, onOpenChange] as const;
}
