/**
 * [Epic 60 #4256] "Daily limits" card of the cockpit. With a `schoolId` it is one school's own
 * limits (`/platform/schools/:id/daily-limits`) plus today's use; without one it is the platform
 * default card on Operations (`/platform/settings/daily-limits`). An empty box means "use the
 * level below" (sent as `null`). Words (D13): daily limit, never cap/quota/rate limit/throttle.
 */
import { DAILY_LIMIT_MAX, type DailyLimitChannel, type DailyLimitsView } from '@biddaloy/shared';
import { Button, Card, Input, Label, RadioRows, Skeleton } from '@biddaloy/ui/components';
import { cockpitRequest } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, toLatinDigits } from '@biddaloy/ui/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

const CHANNELS: DailyLimitChannel[] = ['sms', 'email', 'whatsapp'];
type Remaining = 'default' | 'on' | 'off';
type Body = Partial<Record<DailyLimitChannel, number | null>> & { showRemaining: boolean | null };

const urlOf = (schoolId?: string) =>
  schoolId ? `/platform/schools/${schoolId}/daily-limits` : '/platform/settings/daily-limits';
const keyOf = (schoolId?: string) => ['platform-daily-limits', schoolId ?? 'platform'];

export function DailyLimitsCard({ schoolId }: { schoolId?: string }) {
  const { t } = useTranslation('platform');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keyOf(schoolId),
    queryFn: ({ signal }) => cockpitRequest<DailyLimitsView>({ url: urlOf(schoolId), signal }),
  });
  const save = useMutation({
    retry: false,
    mutationFn: (data: Body) =>
      cockpitRequest<DailyLimitsView>({ method: 'PUT', url: urlOf(schoolId), data }),
    onSuccess: (view) => {
      queryClient.setQueryData(keyOf(schoolId), view);
      void queryClient.invalidateQueries({ queryKey: keyOf(schoolId) });
    },
  });
  const titleId = `daily-limits-title-${schoolId ?? 'platform'}`;

  return (
    <Card padded role="region" aria-labelledby={titleId} className="space-y-4">
      <div>
        <h2 id={titleId} className="text-h2">
          {t('dailyLimits.title')}
        </h2>
        <p className="mt-1 text-text-secondary">
          {t(schoolId ? 'dailyLimits.help' : 'dailyLimits.helpDefaults')}
        </p>
      </div>
      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError || !query.data ? (
        <p role="alert" className="text-caption text-destructive">
          {t('dailyLimits.loadError')}
        </p>
      ) : (
        <LimitsForm
          // Remount on a fresh server value so the boxes show what is stored.
          key={JSON.stringify(query.data.stored)}
          view={query.data}
          isSchool={!!schoolId}
          saving={save.isPending}
          failed={save.isError}
          saved={save.isSuccess}
          onSave={(body) => save.mutate(body)}
        />
      )}
    </Card>
  );
}

function LimitsForm({
  view,
  isSchool,
  saving,
  failed,
  saved,
  onSave,
}: {
  view: DailyLimitsView;
  isSchool: boolean;
  saving: boolean;
  failed: boolean;
  saved: boolean;
  onSave: (body: Body) => void;
}) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const [values, setValues] = React.useState<Record<DailyLimitChannel, string>>(() => ({
    sms: view.stored.sms?.toString() ?? '',
    email: view.stored.email?.toString() ?? '',
    whatsapp: view.stored.whatsapp?.toString() ?? '',
  }));
  const [remaining, setRemaining] = React.useState<Remaining>(
    view.stored.showRemaining === undefined ? 'default' : view.stored.showRemaining ? 'on' : 'off',
  );
  const [invalid, setInvalid] = React.useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body: Body = {
      showRemaining: remaining === 'default' ? null : remaining === 'on',
    };
    for (const channel of CHANNELS) {
      const text = toLatinDigits(values[channel].trim());
      if (text === '') {
        body[channel] = null;
        continue;
      }
      const n = Number(text);
      if (!/^\d+$/.test(text) || n > DAILY_LIMIT_MAX) {
        setInvalid(true);
        return;
      }
      body[channel] = n;
    }
    setInvalid(false);
    onSave(body);
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {CHANNELS.map((channel) => (
          <div key={channel} className="space-y-1">
            <Label htmlFor={`daily-limit-${isSchool}-${channel}`}>
              {t(`dailyLimits.channels.${channel}`)} · {t('dailyLimits.limit')}
            </Label>
            <Input
              id={`daily-limit-${isSchool}-${channel}`}
              inputMode="numeric"
              value={values[channel]}
              onChange={(e) => setValues({ ...values, [channel]: e.target.value })}
            />
            <p className="text-caption text-text-secondary">
              {values[channel] === '' &&
                t(isSchool ? 'dailyLimits.usingDefault' : 'dailyLimits.usingBuiltIn', {
                  value: formatNumber(view.effective[channel], config),
                })}
            </p>
            {view.usedToday && (
              <p className="text-caption text-text-secondary">
                {t('dailyLimits.usedToday')}: {formatNumber(view.usedToday[channel], config)}
              </p>
            )}
          </div>
        ))}
      </div>
      <RadioRows
        legend={t('dailyLimits.showRemaining')}
        value={remaining}
        onValueChange={(next) => setRemaining(next as Remaining)}
        options={[
          {
            value: 'default',
            title: t(
              isSchool
                ? 'dailyLimits.remaining.defaultSchool'
                : 'dailyLimits.remaining.defaultPlatform',
            ),
          },
          { value: 'on', title: t('dailyLimits.remaining.on') },
          { value: 'off', title: t('dailyLimits.remaining.off') },
        ]}
      />
      {invalid && (
        <p role="alert" className="text-caption text-destructive">
          {t('dailyLimits.invalid', { max: formatNumber(DAILY_LIMIT_MAX, config) })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-caption text-destructive">
          {t('dailyLimits.saveError')}
        </p>
      )}
      {saved && !failed && (
        <p role="status" className="text-caption text-text-secondary">
          {t('dailyLimits.saved')}
        </p>
      )}
      <Button type="submit" loading={saving} className="h-11 w-full sm:w-auto">
        {t('dailyLimits.save')}
      </Button>
    </form>
  );
}
