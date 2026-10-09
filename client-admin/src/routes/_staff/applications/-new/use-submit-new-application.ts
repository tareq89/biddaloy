import { ApiError } from '@biddaloy/ui/api';
import {
  useSubmitApplication,
  useUploadApplicationAttachment,
  type ApplicationDto,
  type CreateApplicationInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/**
 * Create once, then upload. The created id is kept, so a retry after a failed upload only
 * repeats the upload and never makes a second application (clone of homework/new.tsx).
 */
export function useSubmitNewApplication() {
  const { t } = useTranslation('applicationsNew');
  const create = useSubmitApplication();
  const upload = useUploadApplicationAttachment();
  const [created, setCreated] = React.useState<ApplicationDto | null>(null);
  const [error, setError] = React.useState<unknown>(undefined);
  const [pending, setPending] = React.useState(false);
  // Blocks a second submit fired before `pending` has re-rendered.
  const inFlight = React.useRef(false);

  /** Resolves to the application once everything is done, else `null` (see `error`/`created`). */
  async function run(body: CreateApplicationInput, files: File[]): Promise<ApplicationDto | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      const app = created ?? (await create.mutateAsync(body));
      setCreated(app);
      if (files.length > 0) await upload.mutateAsync({ id: app.id, files });
      return app;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  // Known `details.code`s read as their own sentence; the server's text is never shown.
  const code = error instanceof ApiError ? (error.details as { code?: string })?.code : undefined;
  const message = error
    ? t(code && code.startsWith('APPLICATION_') ? `errors.${code}` : 'errors.generic', {
        defaultValue: t('errors.generic'),
      })
    : undefined;

  return { run, created, pending, message };
}
