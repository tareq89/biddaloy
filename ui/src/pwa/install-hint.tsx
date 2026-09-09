/**
 * [15.8.3] A small, dismissible card nudging a user toward installing the
 * app — shown once, after a meaningful authenticated action (the plan's
 * example: the first successful data mutation of a session), and only
 * when `useInstallPrompt()` reports `mode === 'prompt'` and
 * `!hintDismissed`. Purely presentational: the caller decides *when* to
 * mount it and owns `onInstall`/`onDismiss`.
 *
 * Wiring "first successful mutation" globally is out of this ticket's
 * territory (`ui/src/pwa/**` and a short list of named files — see the
 * issue) — no low-risk single wiring point exists inside that territory
 * today (`ui/src/api/mutation-queue.ts` handles the *offline* replay
 * queue, not a global React Query success callback, and touching that
 * would risk the queue's own careful semantics for an unrelated feature).
 * Left as a follow-up, filed as #571: a future ticket should render
 * `<InstallHint>` from whatever `client-admin` component first observes a
 * successful mutation (e.g. a `QueryClient` `onSuccess` default in
 * `main.tsx`, or a specific high-traffic mutation like recording a
 * payment).
 */
import { DownloadIcon, XIcon } from 'lucide-react';

import { Button } from '../components/button';
import { Card } from '../components/card';
import { useTranslation } from '../i18n';

export interface InstallHintProps {
  onInstall: () => void;
  onDismiss: () => void;
}

export function InstallHint({ onInstall, onDismiss }: InstallHintProps) {
  const { t } = useTranslation('nav');

  return (
    <Card className="flex items-start gap-3 p-4" role="status">
      <DownloadIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-sm text-foreground">{t('installPrompt.hint.text')}</p>
        {/* One dismiss control, not two — the icon-only `X` below is it.
            An earlier draft also had a text "Dismiss" button here; two
            controls doing the same thing is just confusing, not extra
            affordance. */}
        <div className="flex gap-2">
          <Button size="sm" onClick={onInstall}>
            {t('installPrompt.hint.install')}
          </Button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        iconOnly
        aria-label={t('installPrompt.hint.dismiss')}
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </Card>
  );
}
