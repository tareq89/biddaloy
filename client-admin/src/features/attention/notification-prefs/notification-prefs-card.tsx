/**
 * [67.5.08] "Which alerts push to me": one switch per mutable category (on =
 * pushes), a locked "Urgent" row, and the school's quiet hours as read-only text.
 * Shared by the staff `/security` page and the portal `/portal/account` page.
 */
import { AlertSeverity, type UserRole } from '@biddaloy/shared';
import {
  AlertSeverityBadge,
  Button,
  Card,
  ErrorState,
  Skeleton,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
  type NotificationPrefs,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';
import { LockIcon, MoonIcon } from 'lucide-react';
import * as React from 'react';

import { pushableCategoriesFor } from './pushable-categories';

export function NotificationPrefsCard({ role }: { role: UserRole }) {
  const { t } = useTranslation('attention');
  const { t: tCommon } = useTranslation('common');
  const config = useTenantRegionConfig();
  const query = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const categories: string[] = pushableCategoriesFor(role);
  // Local edits to the muted list of this card's categories; null = untouched.
  const [edited, setEdited] = React.useState<ReadonlySet<string> | null>(null);

  const saved = query.data?.mutedCategories ?? [];
  const savedHere = new Set<string>(saved.filter((c) => categories.includes(c)));
  const muted = edited ?? savedHere;
  const dirty =
    edited !== null &&
    (edited.size !== savedHere.size || [...edited].some((c) => !savedHere.has(c)));

  function save() {
    // PATCH replaces the whole list: keep mutes of categories this role doesn't show.
    const others = saved.filter((c) => !categories.includes(c));
    update.mutate([...others, ...muted] as NotificationPrefs['mutedCategories'], {
      onSuccess: () => {
        setEdited(null);
        toast.success(t('account.saved'));
      },
      onError: () => toast.error(tCommon('status.error')),
    });
  }

  const quiet = query.data?.quietHours;
  const digits = (time: string) => renderDigits(time, config.numerals);

  return (
    <Card padded aria-labelledby="notification-prefs-title" className="flex flex-col gap-4">
      <div>
        <h2 id="notification-prefs-title" className="text-h2">
          {t('account.title')}
        </h2>
        <p className="mt-1 text-text-secondary">{t('account.subtitle')}</p>
      </div>

      {query.isError ? (
        <ErrorState message={t('account.loadError')} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border-subtle">
            <li className="flex min-h-11 items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertSeverityBadge severity={AlertSeverity.CRITICAL} />
                  <span className="inline-flex items-center gap-1 text-label">
                    <LockIcon className="size-3.5" aria-hidden="true" />
                    {t('account.urgentAlways')}
                  </span>
                </div>
                <p id="prefs-urgent-help" className="text-caption text-text-secondary">
                  {t('account.urgentHelp')}
                </p>
              </div>
              <Switch
                checked
                disabled
                aria-label={t('severity.CRITICAL')}
                aria-describedby="prefs-urgent-help"
              />
            </li>
            {categories.map((category) => (
              <li key={category} className="flex min-h-11 items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <label htmlFor={`prefs-${category}`} className="text-label">
                    {t(`category.${category}`)}
                  </label>
                  <p id={`prefs-${category}-help`} className="text-caption text-text-secondary">
                    {t(`account.categoryHelp.${category}`)}
                  </p>
                </div>
                <Switch
                  id={`prefs-${category}`}
                  checked={!muted.has(category)}
                  aria-describedby={`prefs-${category}-help`}
                  onCheckedChange={(on) => {
                    const next = new Set(muted);
                    if (on) next.delete(category);
                    else next.add(category);
                    setEdited(next);
                  }}
                />
              </li>
            ))}
          </ul>

          {quiet && (
            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-text-secondary">
              <MoonIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('account.quietNote', { start: digits(quiet.start), end: digits(quiet.end) })}
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={!dirty} loading={update.isPending}>
              {t('account.save')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
