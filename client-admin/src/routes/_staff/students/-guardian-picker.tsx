/**
 * Search-and-link existing guardians, or create one inline — [8.10.3]'s
 * own AC ("Guardian linking searches existing guardians and supports
 * creating one inline"). Not built on `Combobox`: that component is
 * single-select and filters a static client-side option list, while this
 * needs multi-select over a server-side search plus an inline-create
 * escape hatch — different enough from `Combobox`'s contract that forcing
 * it in would mean reworking the shared component around one caller's
 * needs. Composed instead from `Input`/`Checkbox`/`Button`, the same
 * building blocks `Combobox` itself is built from.
 *
 * Keeps its own `id -> Guardian` cache (`knownGuardians`) so a selected
 * guardian's name still renders once the search query that found them has
 * changed or been cleared — `selectedIds` alone has no name to show.
 */
import { Button, Checkbox, Input, PhoneInput } from '@biddaloy/ui/components';
import {
  useCreateGuardian,
  useDebouncedValue,
  useGuardians,
  type Guardian,
} from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface GuardianPickerProps {
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Already-linked guardians (edit mode) — seeds `knownGuardians` so
   * they render immediately, before any search has run. */
  initialGuardians?: Guardian[];
  config: RegionConfig;
}

interface NewGuardianDraft {
  full_name: string;
  relationship: string;
  phone: string;
  email: string;
}

function emptyDraft(): NewGuardianDraft {
  return { full_name: '', relationship: '', phone: '', email: '' };
}

export function GuardianPicker({
  selectedIds,
  onSelectedIdsChange,
  initialGuardians = [],
  config,
}: GuardianPickerProps) {
  const { t } = useTranslation('students');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [knownGuardians, setKnownGuardians] = React.useState<Record<string, Guardian>>(() =>
    Object.fromEntries(initialGuardians.map((guardian) => [guardian.id, guardian])),
  );
  const [addingNew, setAddingNew] = React.useState(false);
  const [draft, setDraft] = React.useState<NewGuardianDraft>(emptyDraft);
  const [draftError, setDraftError] = React.useState<string | undefined>(undefined);

  const searchQuery = useGuardians({ search: debouncedSearch });
  const createGuardian = useCreateGuardian();

  // `handleCreateGuardian`'s `onSuccess` fires after the mutation's own
  // round trip, by which point a re-render (another checkbox toggled, a
  // guardian removed) may have moved `selectedIds` on from whatever this
  // render's closure captured. A ref always reads the latest value, so
  // the new guardian gets appended to what the user has actually selected
  // by the time the response comes back, not a stale snapshot.
  const selectedIdsRef = React.useRef(selectedIds);
  React.useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  React.useEffect(() => {
    const results = searchQuery.data?.data;
    if (!results || results.length === 0) return;
    setKnownGuardians((current) => {
      const next = { ...current };
      for (const guardian of results) next[guardian.id] = guardian;
      return next;
    });
  }, [searchQuery.data]);

  function toggleSelected(id: string) {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  }

  function removeSelected(id: string) {
    onSelectedIdsChange(selectedIds.filter((existing) => existing !== id));
  }

  function handleCreateGuardian() {
    if (draft.full_name.trim() === '') {
      setDraftError(t('form.guardians.newGuardian.nameRequired'));
      return;
    }
    setDraftError(undefined);
    const relationship = draft.relationship.trim();
    const phone = draft.phone.trim();
    const email = draft.email.trim();
    createGuardian.mutate(
      {
        full_name: draft.full_name.trim(),
        // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
        ...(relationship !== '' ? { relationship } : {}),
        ...(phone !== '' ? { phone } : {}),
        ...(email !== '' ? { email } : {}),
      },
      {
        onSuccess: (guardian) => {
          setKnownGuardians((current) => ({ ...current, [guardian.id]: guardian }));
          onSelectedIdsChange([...selectedIdsRef.current, guardian.id]);
          setDraft(emptyDraft());
          setAddingNew(false);
        },
        onError: (error) => {
          // Otherwise a server validation failure or network error leaves
          // the panel just... sitting there, `isPending` back to false,
          // with nothing telling the user their guardian wasn't created.
          setDraftError(error instanceof Error ? error.message : String(error));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selectedIds.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={t('form.guardians.selectedLabel')}>
          {selectedIds.map((id) => {
            const guardian = knownGuardians[id];
            return (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
              >
                <span>
                  {guardian?.full_name ?? id}
                  {guardian?.relationship ? ` · ${guardian.relationship}` : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSelected(id)}
                  aria-label={t('form.guardians.removeAction', {
                    name: guardian?.full_name ?? id,
                  })}
                >
                  {t('form.guardians.removeAction_short')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Input
        id="student-form-guardian-search"
        aria-label={t('form.guardians.searchLabel')}
        placeholder={t('form.guardians.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {debouncedSearch.trim() !== '' && (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-live="polite">
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('form.guardians.noResults')}</li>
          )}
          {searchQuery.data?.data.map((guardian) => (
            <li key={guardian.id} className="flex items-center gap-2">
              <Checkbox
                id={`guardian-result-${guardian.id}`}
                checked={selectedIds.includes(guardian.id)}
                onCheckedChange={() => toggleSelected(guardian.id)}
              />
              <label htmlFor={`guardian-result-${guardian.id}`} className="text-sm">
                {guardian.full_name}
                {guardian.phone ? ` · ${guardian.phone}` : ''}
              </label>
            </li>
          ))}
        </ul>
      )}

      {!addingNew ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setAddingNew(true)}>
          {t('form.guardians.addNewAction')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Input
            id="student-form-new-guardian-name"
            aria-label={t('form.guardians.newGuardian.nameLabel')}
            placeholder={t('form.guardians.newGuardian.nameLabel')}
            value={draft.full_name}
            onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
          />
          <Input
            id="student-form-new-guardian-relationship"
            aria-label={t('form.guardians.newGuardian.relationshipLabel')}
            placeholder={t('form.guardians.newGuardian.relationshipLabel')}
            value={draft.relationship}
            onChange={(event) => setDraft({ ...draft, relationship: event.target.value })}
          />
          <PhoneInput
            id="student-form-new-guardian-phone"
            aria-label={t('form.guardians.newGuardian.phoneLabel')}
            value={draft.phone}
            config={config}
            onValueChange={(value) => setDraft({ ...draft, phone: value })}
          />
          <Input
            id="student-form-new-guardian-email"
            type="email"
            aria-label={t('form.guardians.newGuardian.emailLabel')}
            placeholder={t('form.guardians.newGuardian.emailLabel')}
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          {draftError && (
            <p role="alert" className="text-sm text-destructive">
              {draftError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              loading={createGuardian.isPending}
              onClick={handleCreateGuardian}
            >
              {t('form.guardians.newGuardian.saveAction')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAddingNew(false);
                setDraft(emptyDraft());
                setDraftError(undefined);
              }}
            >
              {t('form.guardians.newGuardian.cancelAction')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
