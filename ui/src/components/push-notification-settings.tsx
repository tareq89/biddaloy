/**
 * [15.7.6] `/portal/account`'s push-notifications card — mirrors
 * `session-list.tsx`'s split: no data fetching in here, the caller owns
 * `usePushSubscription()` (`ui/src/pwa/use-push-subscription.ts`) and
 * passes its result straight through as props. Card-per-device, matching
 * `SessionList`'s own grammar (this repo's established "list of devices"
 * shape, not a table — portal widths, per `portal/account.tsx`'s own
 * comment on why `SessionList` isn't a table either).
 *
 * `permission === 'unsupported'` renders a single explanatory line and
 * nothing else — no toggle, per #557's own acceptance criterion.
 */
import { useTranslation } from '../i18n';
import { formatRelativeAge } from '../utils';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { Skeleton } from './skeleton';

export interface PushSubscriptionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface PushNotificationSettingsProps {
  permission: 'unsupported' | 'default' | 'granted' | 'denied';
  isSubscribedOnThisDevice: boolean;
  subscriptions: PushSubscriptionRow[] | null;
  loading?: boolean;
  error?: string | null;
  removingId?: string | null;
  onToggle: (next: boolean) => void;
  onRemove: (id: string) => void;
  locale: string;
}

export function PushNotificationSettings({
  permission,
  isSubscribedOnThisDevice,
  subscriptions,
  loading = false,
  error = null,
  removingId = null,
  onToggle,
  onRemove,
  locale,
}: PushNotificationSettingsProps) {
  const { t } = useTranslation('push');

  if (permission === 'unsupported') {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-medium">{t('settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.unsupported')}</p>
      </Card>
    );
  }

  // The current device's own row (if any) is represented by the toggle
  // above, not duplicated in this list — see the hook's own comment on
  // why there's no endpoint to distinguish it by, so this list is simply
  // "every subscription the server knows about".
  const otherDevices = subscriptions ?? [];

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-medium">{t('settings.title')}</h2>

      <div className="flex items-start gap-3">
        <Checkbox
          id="push-toggle-this-device"
          checked={isSubscribedOnThisDevice}
          disabled={permission === 'denied' || loading}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="push-toggle-this-device">{t('settings.toggleLabel')}</Label>
          <p className="text-sm text-muted-foreground">
            {permission === 'denied'
              ? t('settings.denied')
              : isSubscribedOnThisDevice
                ? t('settings.toggleOnHint')
                : t('settings.toggleOffHint')}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">
          {t('settings.otherDevices')}
        </h3>
        {loading ? (
          <Skeleton className="h-14 w-full rounded-lg" />
        ) : otherDevices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.noOtherDevices')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {otherDevices.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card p-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{row.user_agent ?? t('settings.unknownDevice')}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.last_used_at
                      ? t('settings.lastUsed', {
                          when: formatRelativeAge(new Date(row.last_used_at).getTime(), locale),
                        })
                      : t('settings.neverUsed')}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={removingId === row.id}
                  onClick={() => onRemove(row.id)}
                >
                  {t('settings.remove')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
