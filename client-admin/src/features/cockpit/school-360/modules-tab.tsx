/**
 * #3934 Epic 77 D3, D7, D21: the owner's two module screens.
 *
 * - `ModulesTab`: School 360 "Modules" tab. Per module a select (no lock / locked On / locked Off)
 *   with the school's own choice beside it. A module the platform switched off is greyed.
 * - `GlobalModulesCard`: Operations. One switch per module for ALL schools; the whole map is saved
 *   on every change.
 *
 * Both writes ask the owner's authenticator code (`platform.school_control`) through the prompt
 * host. A failed write is one fixed sentence and the control goes back (Rule 23); never retried
 * (Rule 25). A school's own choice is never touched: turning a module back on restores it (D7).
 */
import type { ModuleKey } from '@biddaloy/shared';
import {
  Card,
  ConfirmDialog,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Switch,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  usePlatformModules,
  useSchoolPlatformModules,
  useSetPlatformModules,
  useSetSchoolModuleLock,
  type ModuleLock,
  type PlatformModules,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** Same four groups, same order as the school's own Modules tab. */
const GROUPS = [
  [
    'study',
    [
      'attendance',
      'exams',
      'seatPlans',
      'evaluations',
      'homework',
      'syllabus',
      'studyPlans',
      'routines',
      'programs',
    ],
  ],
  ['money', ['fees', 'fines']],
  ['people', ['staffAttendance', 'admission', 'applications']],
  ['communication', ['notices', 'messaging', 'website']],
] as const satisfies ReadonlyArray<readonly [string, readonly ModuleKey[]]>;

const ROW =
  'flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-3 md:flex-row md:items-center md:p-4';

/** Run a write; `true` when it went through. A closed code prompt is not a failure. */
async function attempt(write: () => Promise<unknown>): Promise<'ok' | 'cancelled' | 'failed'> {
  try {
    await write();
    return 'ok';
  } catch (error) {
    return error instanceof ApprovalCancelledError ? 'cancelled' : 'failed';
  }
}

const SETTINGS_NS = 'settings';

function useNames() {
  // The names live in the school's own `settings` namespace (one source of truth). Kept out of a
  // string literal because check:i18n resolves one namespace per file; the keys below are dynamic.
  const { t: tSettings } = useTranslation(SETTINGS_NS);
  return {
    group: (g: string) => tSettings(`modulesWords.groups.${g}`),
    module: (k: string) => tSettings(`modulesWords.moduleNames.${k}`),
  };
}

/** The lock value the select shows. */
const toValue = (lock: ModuleLock | undefined) => lock ?? 'none';

export function ModulesTab({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation('school360');
  const names = useNames();
  const platform = usePlatformModules();
  const school = useSchoolPlatformModules(schoolId);
  const setLock = useSetSchoolModuleLock(schoolId);
  const [pending, setPending] = React.useState<Record<string, ModuleLock>>({});
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(new Set());

  async function change(key: string, lock: ModuleLock) {
    setFailed((f) => new Set([...f].filter((k) => k !== key)));
    setPending((p) => ({ ...p, [key]: lock }));
    const result = await attempt(() => setLock.mutateAsync({ key, lock }));
    // Success: the refetched read holds the value. Failure or cancel: the select goes back.
    setPending((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    if (result === 'failed') setFailed((f) => new Set(f).add(key));
  }

  if (platform.isError || school.isError) {
    return (
      <ErrorState
        message={t('modules.loadError')}
        retryLabel={t('modules.retry')}
        onRetry={() => {
          void platform.refetch();
          void school.refetch();
        }}
      />
    );
  }
  if (!platform.data || !school.data) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="space-y-5 p-4 md:p-5">
      <div>
        <h2 className="text-h3 font-semibold">{t('modules.lock.title')}</h2>
        <p className="text-body-sm text-muted-foreground">{t('modules.lock.caption')}</p>
      </div>
      {GROUPS.map(([group, keys]) => (
        <section key={group} aria-labelledby={`lock-group-${group}`} className="space-y-2">
          <h3 id={`lock-group-${group}`} className="text-h3">
            {names.group(group)}
          </h3>
          <ul className="space-y-2">
            {keys.map((key) => {
              const platformOff = platform.data[key] === false;
              const own = school.data[key];
              const lock = key in pending ? pending[key] : own?.lock;
              return (
                <li key={key} className={`${ROW} ${platformOff ? 'opacity-60' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium">{names.module(key)}</span>
                    <span className="block text-text-secondary">
                      {platformOff
                        ? t('modules.lock.platformOff')
                        : own?.on === undefined
                          ? t('modules.lock.schoolNone')
                          : t('modules.lock.school', {
                              state: t(own.on ? 'modules.on' : 'modules.off'),
                            })}
                    </span>
                    {failed.has(key) && (
                      <span role="alert" className="block text-destructive">
                        {t('modules.notSaved')}
                      </span>
                    )}
                  </div>
                  {lock && <StatusBadge tone="info" label={t('modules.lock.locked')} />}
                  <Select
                    value={toValue(lock)}
                    disabled={platformOff || key in pending}
                    onValueChange={(v) =>
                      void change(key, v === 'none' ? null : (v as 'on' | 'off'))
                    }
                  >
                    <SelectTrigger
                      aria-label={t('modules.lock.selectLabel', { module: names.module(key) })}
                      className="min-h-11 w-full md:w-48"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('modules.lock.none')}</SelectItem>
                      <SelectItem value="on">{t('modules.lock.on')}</SelectItem>
                      <SelectItem value="off">{t('modules.lock.off')}</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Card>
  );
}

export function GlobalModulesCard() {
  const { t } = useTranslation('school360');
  const names = useNames();
  const platform = usePlatformModules();
  const setModules = useSetPlatformModules();
  const [pending, setPending] = React.useState<Record<string, boolean>>({});
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(new Set());
  const [confirmKey, setConfirmKey] = React.useState<string | null>(null);

  /** Saves the FULL map: only `false` keys are kept, an absent key is on. */
  async function change(key: string, on: boolean) {
    const next: PlatformModules = { ...platform.data };
    if (on) delete next[key];
    else next[key] = false;
    setFailed((f) => new Set([...f].filter((k) => k !== key)));
    setPending((p) => ({ ...p, [key]: on }));
    const result = await attempt(() => setModules.mutateAsync({ modules: next }));
    setPending((p) => {
      const rest = { ...p };
      delete rest[key];
      return rest;
    });
    if (result === 'failed') setFailed((f) => new Set(f).add(key));
  }

  return (
    <Card padded role="region" aria-labelledby="ops-modules-title" className="space-y-5">
      <div>
        <h2 id="ops-modules-title" className="text-h2">
          {t('modules.global.title')}
        </h2>
        <p className="text-body-sm text-muted-foreground">{t('modules.global.caption')}</p>
      </div>
      {platform.isError ? (
        <ErrorState
          message={t('modules.loadError')}
          retryLabel={t('modules.retry')}
          onRetry={() => void platform.refetch()}
        />
      ) : !platform.data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        GROUPS.map(([group, keys]) => (
          <section key={group} aria-labelledby={`global-group-${group}`} className="space-y-2">
            <h3 id={`global-group-${group}`} className="text-h3">
              {names.group(group)}
            </h3>
            <ul className="space-y-2">
              {keys.map((key) => {
                // While a save is in flight the switch shows what was just asked for.
                const on = key in pending ? pending[key] : platform.data[key] !== false;
                return (
                  <li key={key} className={ROW}>
                    <div className="min-w-0 flex-1">
                      <span className="block font-medium">{names.module(key)}</span>
                      {failed.has(key) && (
                        <span role="alert" className="block text-destructive">
                          {t('modules.notSaved')}
                        </span>
                      )}
                    </div>
                    <label className="flex min-h-11 items-center gap-2">
                      <Switch
                        aria-label={names.module(key)}
                        checked={on}
                        // One save at a time: each one replaces the whole map.
                        disabled={setModules.isPending}
                        onCheckedChange={(next) =>
                          next ? void change(key, true) : setConfirmKey(key)
                        }
                      />
                      <span className="w-8">{t(on ? 'modules.on' : 'modules.off')}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <ConfirmDialog
        open={confirmKey !== null}
        onOpenChange={(open) => !open && setConfirmKey(null)}
        title={t('modules.global.confirmTitle', {
          module: confirmKey ? names.module(confirmKey) : '',
        })}
        description={t('modules.global.confirmBody')}
        confirmLabel={t('modules.global.confirmAction')}
        tone="default"
        onConfirm={() => {
          if (confirmKey) void change(confirmKey, false);
          setConfirmKey(null);
        }}
      />
    </Card>
  );
}
