import {
  ModuleKey,
  resolveModuleState,
  type ModuleState,
  type SchoolModules,
  type UserRole,
} from '@biddaloy/shared';
import { Button, ErrorState, Switch, toast } from '@biddaloy/ui/components';
import { useSchoolProfile, useUpdateSchoolSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { RoleOffDialog } from './RoleOffDialog';

/** D30: the four groups, in the order they show. */
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

/** The platform (or a base module) decides: the switch and the dialog stay shut. */
const isBlocked = (s: ModuleState) =>
  s.source === 'platform-off' || s.source === 'platform-lock' || s.source === 'dependency';

interface ModulesTabProps {
  schoolId: string;
}

/**
 * [77.4.03] D30/D31/D32: Settings › Modules & words › Modules. A switch saves at once (an Undo
 * toast, no Save button). A failed save puts the switch back and says so on the row.
 */
export function ModulesTab({ schoolId }: ModulesTabProps) {
  const { t } = useTranslation('settings');
  const profile = useSchoolProfile();
  const qc = useQueryClient();
  const update = useUpdateSchoolSettings(schoolId);
  // What the admin just asked for, until the profile catches up (or the save fails).
  const [pending, setPending] = React.useState<Partial<Record<ModuleKey, boolean>>>({});
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(new Set());
  const [dialogKey, setDialogKey] = React.useState<ModuleKey | null>(null);

  const platform = profile.data?.modules.platform ?? null;
  const school: SchoolModules = profile.data?.modules.school ?? {};
  const view: SchoolModules = { ...school };
  for (const [key, on] of Object.entries(pending) as [ModuleKey, boolean][]) {
    view[key] = { ...view[key], on };
  }
  const stateOf = (key: ModuleKey) =>
    resolveModuleState({ platform, school: view, role: null }, key);
  const nameOf = (key: ModuleKey) => t(`modulesWords.moduleNames.${key}`);

  /** One PATCH. Returns whether it went through. Never retried (Rule 25). */
  async function save(
    key: ModuleKey,
    entry: { on?: boolean; offForRoles?: UserRole[] },
    slot: string,
  ) {
    setFailed((f) => new Set([...f].filter((s) => s !== slot)));
    try {
      await update.mutateAsync({ version: 1, modules: { [key]: entry } });
      await qc.invalidateQueries({ queryKey: ['school-profile'] });
      return true;
    } catch {
      setFailed((f) => new Set(f).add(slot));
      return false;
    }
  }

  async function setOn(key: ModuleKey, on: boolean, announce: boolean) {
    const before = stateOf(key).on;
    setPending((p) => ({ ...p, [key]: on }));
    const ok = await save(key, { on }, key);
    // Success: the refetched profile now holds the value. Failure: drop it, the switch reverts.
    setPending((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    if (ok && announce) {
      toast(
        t('modulesWords.modules.saved', {
          module: nameOf(key),
          state: t(on ? 'modulesWords.modules.on' : 'modulesWords.modules.off'),
        }),
        {
          action: {
            label: t('modulesWords.modules.undo'),
            onClick: () => void setOn(key, before, false),
          },
        },
      );
    }
  }

  async function saveRoles(key: ModuleKey, roles: UserRole[]) {
    if (await save(key, { offForRoles: roles }, `roles:${key}`)) setDialogKey(null);
  }

  if (profile.isPending) return null;
  // Without the profile every switch would show a guess, and a click would write on it.
  if (!profile.data) {
    return (
      <ErrorState
        message={t('modulesWords.modules.loadError')}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {GROUPS.map(([group, keys]) => (
        <section key={group} aria-labelledby={`modules-group-${group}`} className="space-y-2">
          <h3 id={`modules-group-${group}`} className="text-h3">
            {t(`modulesWords.groups.${group}`)}
          </h3>
          <ul className="space-y-2">
            {keys.map((key) => {
              const state = stateOf(key);
              const blocked = isBlocked(state);
              const hidden = school[key]?.offForRoles ?? [];
              const note =
                state.source === 'platform-off'
                  ? t('modulesWords.modules.source.platformOff')
                  : state.source === 'platform-lock'
                    ? [
                        state.on ? t('modulesWords.modules.cannotTurnOff') : null,
                        t('modulesWords.modules.source.platformLock'),
                      ]
                        .filter(Boolean)
                        .join(' ')
                    : state.source === 'dependency' && state.dependsOn
                      ? t('modulesWords.modules.offBecause', { base: nameOf(state.dependsOn) })
                      : state.source === 'school'
                        ? t('modulesWords.modules.source.school')
                        : null;
              return (
                <li
                  key={key}
                  className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-e1 md:flex-row md:items-center md:p-4"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium text-text-primary">{nameOf(key)}</span>
                    <span className="block text-text-secondary">
                      {t(`modulesWords.moduleLines.${key}`)}
                    </span>
                    {note && <span className="block text-text-secondary">{note}</span>}
                    {failed.has(key) && (
                      <span role="alert" className="block text-destructive">
                        {t('modulesWords.modules.notSaved')}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={blocked}
                    onClick={() => setDialogKey(key)}
                  >
                    {hidden.length > 0
                      ? t('modulesWords.modules.whoCantSeeSome', { count: hidden.length })
                      : t('modulesWords.modules.whoCantSee')}
                  </Button>
                  <label className="flex min-h-11 items-center gap-2">
                    <Switch
                      aria-label={nameOf(key)}
                      checked={state.on}
                      disabled={blocked || key in pending}
                      onCheckedChange={(on) => void setOn(key, on, true)}
                    />
                    <span className="w-8">
                      {t(state.on ? 'modulesWords.modules.on' : 'modulesWords.modules.off')}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {dialogKey && (
        <RoleOffDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setFailed((f) => new Set([...f].filter((x) => x !== `roles:${dialogKey}`)));
            setDialogKey(null);
          }}
          moduleName={nameOf(dialogKey)}
          current={school[dialogKey]?.offForRoles ?? []}
          saving={update.isPending}
          failed={failed.has(`roles:${dialogKey}`)}
          onSave={(roles) => void saveRoles(dialogKey, roles)}
        />
      )}
    </div>
  );
}
