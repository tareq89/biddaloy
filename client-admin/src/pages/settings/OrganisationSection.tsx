/**
 * [33.4.1] The "Shift, version & group" settings section — a UI over
 * [33.1.1]'s `TenantSettings.organisation.{shifts,versions,groups}` and
 * [33.3.1]'s explicit rename instruction. Same "clone `AttendanceSection`'s
 * plumbing" starting point the plan calls for, but the actual editing
 * surface is three parallel list editors rather than a flat field form —
 * `react-hook-form`/`FormShell`'s per-field validation summary doesn't fit
 * "add/rename/remove a row in an array," so this component manages its
 * own local list state instead and reuses `FormSection` purely for the
 * legend/border chrome every other settings section already has.
 *
 * [D4] A value still in use by a class/section is rejected by the
 * server, not pre-checked here — the count can change between render and
 * save, so the server is the sole authority. Its refusal message
 * ("Cannot remove "X" from shifts — 2 row(s) still use it…") is parsed
 * back onto the offending row rather than shown as a generic banner.
 *
 * [33.3.1] A rename is sent as an explicit `{ list, from, to }` instruction
 * alongside the normal `organisation` patch (same request) — never
 * inferred from a remove+add diff. Only one rename per list per save, same
 * limit the server enforces (`schools.service.ts`'s `applyOrganisationVocabularyGuard`).
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, Input } from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type OrganisationSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FormSection, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import * as React from 'react';

type ListName = 'shifts' | 'versions' | 'groups';
const LIST_NAMES: ListName[] = ['shifts', 'versions', 'groups'];

interface Entry {
  value: string;
  markedForRemoval: boolean;
}

interface Rename {
  from: string;
  to: string;
}

interface ListState {
  entries: Entry[];
  addValue: string;
  renamingValue: string | null;
  renameInput: string;
  rename: Rename | null;
  rowError: { value: string; message: string } | null;
}

function emptyListState(values: string[]): ListState {
  return {
    entries: values.map((value) => ({ value, markedForRemoval: false })),
    addValue: '',
    renamingValue: null,
    renameInput: '',
    rename: null,
    rowError: null,
  };
}

function toInitialState(
  organisation: OrganisationSettings | undefined,
): Record<ListName, ListState> {
  return {
    shifts: emptyListState(organisation?.shifts ?? []),
    versions: emptyListState(organisation?.versions ?? []),
    groups: emptyListState(organisation?.groups ?? []),
  };
}

function finalValues(state: ListState): string[] {
  return state.entries.filter((entry) => !entry.markedForRemoval).map((entry) => entry.value);
}

function isDirty(state: ListState, saved: string[]): boolean {
  const current = finalValues(state);
  return current.length !== saved.length || current.some((value, index) => value !== saved[index]);
}

/** Parses `schools.service.ts`'s own "Cannot remove ... N row(s) still
 * use it" refusal text back into which list/value it's about — the
 * server keeps this message stable for exactly this reason (see
 * `ui/src/api/errors.ts`'s own comment on `ApiErrorBody`). */
const REMOVE_REFUSAL_PATTERN = /^Cannot remove "(.+)" from (shifts|versions|groups) —/;

export interface OrganisationSectionProps {
  schoolId: string;
  organisation: OrganisationSettings | undefined;
}

export function OrganisationSection({ schoolId, organisation }: OrganisationSectionProps) {
  const { t } = useTranslation('settings');
  const [lists, setLists] = React.useState(() => toInitialState(organisation));
  const savedRef = React.useRef({
    shifts: organisation?.shifts ?? [],
    versions: organisation?.versions ?? [],
    groups: organisation?.groups ?? [],
  });
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const [genericError, setGenericError] = React.useState<string | null>(null);

  const dirty = LIST_NAMES.some((list) => isDirty(lists[list], savedRef.current[list]));
  useWarnUnsavedChanges(dirty);

  function updateList(list: ListName, updater: (state: ListState) => ListState) {
    setLists((prev) => ({ ...prev, [list]: updater(prev[list]) }));
  }

  function handleAdd(list: ListName) {
    updateList(list, (state) => {
      const value = state.addValue.trim();
      if (!value) return state;
      return {
        ...state,
        entries: [...state.entries, { value, markedForRemoval: false }],
        addValue: '',
      };
    });
  }

  function handleToggleRemove(list: ListName, value: string) {
    updateList(list, (state) => ({
      ...state,
      entries: state.entries.map((entry) =>
        entry.value === value ? { ...entry, markedForRemoval: !entry.markedForRemoval } : entry,
      ),
      rowError: state.rowError?.value === value ? null : state.rowError,
    }));
  }

  function handleStartRename(list: ListName, value: string) {
    updateList(list, (state) => ({ ...state, renamingValue: value, renameInput: value }));
  }

  function handleCancelRename(list: ListName) {
    updateList(list, (state) => ({ ...state, renamingValue: null, renameInput: '' }));
  }

  function handleConfirmRename(list: ListName) {
    updateList(list, (state) => {
      const from = state.renamingValue;
      const to = state.renameInput.trim();
      if (!from || !to || to === from) return { ...state, renamingValue: null, renameInput: '' };
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.value === from ? { ...entry, value: to } : entry,
        ),
        rename: { from, to },
        renamingValue: null,
        renameInput: '',
      };
    });
  }

  function handleSave() {
    setGenericError(null);
    setLists((prev) => {
      const cleared = LIST_NAMES.reduce(
        (acc, list) => ({ ...acc, [list]: { ...prev[list], rowError: null } }),
        {} as Record<ListName, ListState>,
      );
      return cleared;
    });

    const organisationPatch = {
      shifts: finalValues(lists.shifts),
      versions: finalValues(lists.versions),
      groups: finalValues(lists.groups),
    };
    const organisationRenames = LIST_NAMES.filter((list) => lists[list].rename !== null).map(
      (list) => ({ list, from: lists[list].rename!.from, to: lists[list].rename!.to }),
    );

    updateSettings.mutate(
      {
        version: 1,
        organisation: organisationPatch,
        ...(organisationRenames.length > 0 ? { organisationRenames } : {}),
      },
      {
        onSuccess: (settings) => {
          savedRef.current = {
            shifts: settings.organisation?.shifts ?? [],
            versions: settings.organisation?.versions ?? [],
            groups: settings.organisation?.groups ?? [],
          };
          setLists(toInitialState(settings.organisation));
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          const match = REMOVE_REFUSAL_PATTERN.exec(message);
          if (match && error instanceof ApiError) {
            const value = match[1]!;
            const list = match[2] as ListName;
            updateList(list, (state) => ({ ...state, rowError: { value, message } }));
            return;
          }
          setGenericError(message);
        },
      },
    );
  }

  return (
    <FormSection legend={t('organisation.legend')}>
      {LIST_NAMES.map((list) => (
        <VocabularyList
          key={list}
          list={list}
          state={lists[list]}
          onAddValueChange={(value) => updateList(list, (state) => ({ ...state, addValue: value }))}
          onAdd={() => handleAdd(list)}
          onToggleRemove={(value) => handleToggleRemove(list, value)}
          onStartRename={(value) => handleStartRename(list, value)}
          onCancelRename={() => handleCancelRename(list)}
          onRenameInputChange={(value) =>
            updateList(list, (state) => ({ ...state, renameInput: value }))
          }
          onConfirmRename={() => handleConfirmRename(list)}
        />
      ))}

      {genericError && (
        <p role="alert" className="text-sm text-destructive">
          {genericError}
        </p>
      )}

      <Button type="button" onClick={handleSave} loading={updateSettings.isPending}>
        {t('save.action')}
      </Button>
      {updateSettings.isSuccess && !genericError && <p role="status">{t('save.success')}</p>}
    </FormSection>
  );
}

interface VocabularyListProps {
  list: ListName;
  state: ListState;
  onAddValueChange: (value: string) => void;
  onAdd: () => void;
  onToggleRemove: (value: string) => void;
  onStartRename: (value: string) => void;
  onCancelRename: () => void;
  onRenameInputChange: (value: string) => void;
  onConfirmRename: () => void;
}

const LABEL_KEY: Record<ListName, string> = {
  shifts: 'organisation.shiftsLabel',
  versions: 'organisation.versionsLabel',
  groups: 'organisation.groupsLabel',
};

function VocabularyList({
  list,
  state,
  onAddValueChange,
  onAdd,
  onToggleRemove,
  onStartRename,
  onCancelRename,
  onRenameInputChange,
  onConfirmRename,
}: VocabularyListProps) {
  const { t } = useTranslation('settings');

  return (
    <fieldset className="grid gap-2" data-testid={`organisation-${list}`}>
      <legend className="text-sm font-medium">{t(LABEL_KEY[list])}</legend>

      {state.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('organisation.emptyList')}</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {state.entries.map((entry) => (
          <li key={entry.value} className="flex flex-col gap-1">
            {state.renamingValue === entry.value ? (
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t('organisation.renamePlaceholder')}
                  value={state.renameInput}
                  onChange={(event) => onRenameInputChange(event.target.value)}
                  placeholder={t('organisation.renamePlaceholder')}
                />
                <Button type="button" size="sm" onClick={onConfirmRename}>
                  {t('organisation.renameConfirm')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onCancelRename}>
                  {t('organisation.renameCancel')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className={
                    entry.markedForRemoval
                      ? 'text-sm text-muted-foreground line-through'
                      : 'text-sm'
                  }
                >
                  {entry.value}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onStartRename(entry.value)}
                >
                  {t('organisation.renameAction')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onToggleRemove(entry.value)}
                >
                  {t('organisation.removeAction')}
                </Button>
              </div>
            )}
            {state.rowError?.value === entry.value && (
              <p role="alert" className="text-sm text-destructive">
                {state.rowError.message}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          aria-label={t('organisation.addPlaceholder')}
          value={state.addValue}
          onChange={(event) => onAddValueChange(event.target.value)}
          placeholder={t('organisation.addPlaceholder')}
        />
        <Button type="button" size="sm" onClick={onAdd}>
          {t('organisation.addAction')}
        </Button>
      </div>
    </fieldset>
  );
}
