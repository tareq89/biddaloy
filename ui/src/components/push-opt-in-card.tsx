/**
 * [15.7.6] One-time inline card offering to enable push, shown after a
 * guardian's first successful meaningful portal action (e.g. viewing an
 * invoice — the caller decides when, this component just renders and
 * fires callbacks). Dismiss state lives in `localStorage` via
 * `../pwa/push-opt-in-dismissal.ts`; the caller is responsible for
 * checking `isPushOptInDismissed()` before rendering this at all — kept
 * out of this component so it stays a plain, testable, prop-driven view
 * like every other component in this package.
 *
 * `onEnable` is the only place a click on this card reaches
 * `Notification.requestPermission()` (via the caller's `subscribe()`) —
 * never rendered in a way that calls it itself on mount.
 */
import { useTranslation } from '../i18n';

import { Button } from './button';
import { Card } from './card';

export interface PushOptInCardProps {
  onEnable: () => void;
  onDismiss: () => void;
  enabling?: boolean;
}

export function PushOptInCard({ onEnable, onDismiss, enabling = false }: PushOptInCardProps) {
  const { t } = useTranslation('push');

  return (
    <Card className="flex flex-col gap-3 p-4" role="region" aria-label={t('optIn.title')}>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{t('optIn.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('optIn.body')}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" loading={enabling} onClick={onEnable}>
          {t('optIn.enable')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t('optIn.dismiss')}
        </Button>
      </div>
    </Card>
  );
}
