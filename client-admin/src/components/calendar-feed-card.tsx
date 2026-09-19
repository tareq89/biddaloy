/**
 * [17.4.3] The calendar feed "subscribe" card — mounted on both
 * `/_staff/security` and `/portal/account` (any signed-in user, any
 * role). Shows the caller's own `webcal://` link, masked the same way
 * `SecretField` masks a stored secret, with Copy and a confirm-gated
 * Regenerate.
 *
 * Not built on `SecretField` itself — that component's whole contract is
 * "never render the plaintext, only a configured/not-configured state"
 * (see its own docstring), because a stored integration secret really is
 * write-only. A subscribe link is the opposite: the user is *meant* to
 * read and copy it, just not have it shoulder-surfed by default. So this
 * renders the real URL behind a `type="password"`-style mask with its own
 * reveal, rather than reusing `SecretField`'s configured/hint copy.
 *
 * Hidden entirely without `CALENDAR_READ` — same rule the calendar route
 * itself uses (`route-permissions.ts`).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
  toast,
} from '@biddaloy/ui/components';
import { useCalendarFeed, useHasPermission, useRegenerateCalendarFeed } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from './MutationErrorMessage';

export function CalendarFeedCard() {
  const { t } = useTranslation('calendarFeed');
  const canRead = useHasPermission(Permission.CALENDAR_READ);
  const feedQuery = useCalendarFeed();
  const regenerate = useRegenerateCalendarFeed();
  const [revealed, setRevealed] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    if (confirmOpen) regenerate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [confirmOpen]);

  if (!canRead) return null;

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('field.copied'));
    } catch {
      toast.error(t('field.copyFailed'));
    }
  }

  async function handleRegenerate(): Promise<void> {
    try {
      await regenerate.mutateAsync();
      setConfirmOpen(false);
      setRevealed(false);
    } catch {
      // Swallowed: `regenerate.isError`/`regenerate.error` already drive
      // the inline `MutationErrorMessage` below — the dialog stays open
      // so the user can retry without re-confirming.
    }
  }

  const url = feedQuery.data?.url;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t('card.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('card.description')}</p>
      </div>

      {feedQuery.isPending && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {feedQuery.isError && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-destructive">{t('error.load')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void feedQuery.refetch()}
          >
            {t('error.retry')}
          </Button>
        </div>
      )}

      {url && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calendar-feed-url" className="text-sm font-medium">
              {t('field.label')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="calendar-feed-url"
                type={revealed ? 'text' : 'password'}
                readOnly
                value={url}
                className="h-8 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRevealed((current) => !current)}
              >
                {revealed ? t('field.hide') : t('field.show')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopy(url)}
              >
                {t('field.copy')}
              </Button>
            </div>
          </div>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="self-start">
                {t('regenerate.action')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('regenerate.confirmTitle')}</DialogTitle>
                <DialogDescription>{t('regenerate.confirmDescription')}</DialogDescription>
              </DialogHeader>
              {regenerate.isError && <MutationErrorMessage error={regenerate.error} />}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
                  {t('regenerate.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  disabled={regenerate.isPending}
                >
                  {regenerate.isPending ? t('regenerate.loading') : t('regenerate.confirmAction')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p className="font-medium">{t('howTo.title')}</p>
            <p>{t('howTo.google')}</p>
            <p>{t('howTo.apple')}</p>
            <p>{t('howTo.outlook')}</p>
          </div>
        </>
      )}
    </Card>
  );
}
