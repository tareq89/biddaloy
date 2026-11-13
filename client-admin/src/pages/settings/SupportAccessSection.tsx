/**
 * [99.G4.04] "Biddaloy support access" settings section: the three-way switch (Allowed, Ask each
 * time, Blocked), who came in during the last 90 days, End for a live login, and the requests
 * waiting for approval (each opens `/support-access/requests/$requestId`). Only the server decides
 * who may change it (`SETTINGS_MANAGE`, and a support login is refused there, D4).
 */
import { ChoiceCards, ConfirmDialog, ErrorState } from '@biddaloy/ui/components';
import {
  useChangeSupportAccessMode,
  useEndSupportSession,
  useSupportAccessSettings,
  useSupportPlatformActions,
  useSupportRequests,
  useSupportSessions,
  type SupportAccessMode,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SupportAccessSessionsList } from './SupportAccessSessionsList';

const DAYS = 90;
const MODES: readonly SupportAccessMode[] = ['allowed', 'ask', 'blocked'];

export function SupportAccessSection() {
  const { t } = useTranslation('supportAccess');
  const { t: tAuth } = useTranslation('auth');
  const settings = useSupportAccessSettings();
  const change = useChangeSupportAccessMode();
  const sessions = useSupportSessions({ days: DAYS, limit: 100 });
  const platformActions = useSupportPlatformActions({ days: DAYS, limit: 100 });
  const requests = useSupportRequests({ status: 'pending', limit: 100 });
  const end = useEndSupportSession();
  const [picked, setPicked] = React.useState<SupportAccessMode | undefined>(undefined);
  const [warnOpen, setWarnOpen] = React.useState(false);

  const saved = settings.data?.mode;
  const draft = picked ?? saved;

  function save(mode: SupportAccessMode) {
    setWarnOpen(false);
    change.mutate(mode, { onSuccess: () => setPicked(undefined) });
  }

  const waiting = requests.data?.filter((r) => r.status === 'REQUESTED') ?? [];

  return (
    <SettingsSection
      id="support-access-section"
      title={t('title')}
      description={t('description')}
      {...(draft
        ? {
            onSubmit: (e: React.FormEvent) => {
              e.preventDefault();
              if (draft === saved) return;
              // D16: blocking ends live logins now, so say it before it happens.
              if (draft === 'blocked') setWarnOpen(true);
              else save(draft);
            },
            saving: change.isPending,
            saveLabel: t('save'),
            footerStart: change.isSuccess && picked === undefined ? <SettingsSaved /> : undefined,
          }
        : {})}
    >
      {settings.isError ? (
        <ErrorState message={t('loadError')} onRetry={() => void settings.refetch()} />
      ) : !draft ? (
        <p role="status" className="mt-4 text-text-secondary">
          {t('loading')}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <ChoiceCards
            label={t('choiceLabel')}
            value={draft}
            onValueChange={(v) => {
              change.reset();
              setPicked(v as SupportAccessMode);
            }}
            columns={3}
            options={MODES.map((m) => ({
              value: m,
              title: t(m),
              description: t(`${m}Note`),
            }))}
          />
          {draft !== saved && (
            <p role="status" className="font-medium">
              {t(`changes${draft}`)}
            </p>
          )}
          <p className="text-text-secondary">{t('emergency')}</p>
          {change.isError && (
            <p role="alert" className="font-medium text-status-overdue-fg">
              {t('saveError')}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-border-subtle pt-4">
        <h3 className="text-h3">{t('requestsTitle')}</h3>
        {waiting.length === 0 ? (
          <p className="mt-2 text-text-secondary">{t('requestsNone')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {waiting.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {r.kind === 'WRITE'
                    ? t('reqWrite')
                    : t('reqAsk', {
                        person: r.personName,
                        role: tAuth(`schoolPicker.roles.${r.role}`),
                      })}
                </span>
                <Link
                  to="/support-access/requests/$requestId"
                  params={{ requestId: r.id }}
                  className="inline-flex h-11 items-center font-medium text-primary"
                >
                  {t('open')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-border-subtle pt-4">
        <SupportAccessSessionsList
          sessions={sessions.data}
          platformActions={platformActions.data}
          loading={sessions.isPending || platformActions.isPending}
          error={sessions.isError || platformActions.isError}
          ending={end.isPending}
          endFailed={end.isError}
          onEnd={(id) => end.mutate({ id })}
        />
      </div>

      <ConfirmDialog
        open={warnOpen}
        onOpenChange={setWarnOpen}
        title={t('blockTitle')}
        description={t('blockBody')}
        confirmLabel={t('blockConfirm')}
        busy={change.isPending}
        onConfirm={() => save('blocked')}
      />
    </SettingsSection>
  );
}
