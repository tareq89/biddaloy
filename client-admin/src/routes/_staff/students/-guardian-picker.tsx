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
import { Button, Checkbox, Input, Label, PhoneInput } from '@biddaloy/ui/components';
import {
  useCreateGuardian,
  useDebouncedValue,
  useGuardians,
  type Guardian,
} from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';
import { CircleMinusIcon, SearchIcon, UserPlusIcon, UserRoundIcon } from 'lucide-react';
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
        onError: () => {
          // Otherwise a server validation failure or network error leaves
          // the panel just... sitting there, `isPending` back to false,
          // with nothing telling the user their guardian wasn't created.
          setDraftError(t('form.guardians.newGuardian.createError'));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selectedIds.length > 0 && (
        <>
          <p id="student-form-linked-guardians" className="text-label">
            {t('form.guardians.selectedLabel')}
          </p>
          <ul
            aria-labelledby="student-form-linked-guardians"
            className="divide-y divide-border-subtle rounded-md border border-border-subtle"
          >
            {selectedIds.map((id) => {
              const guardian = knownGuardians[id];
              const name = guardian?.full_name ?? t('form.guardians.unknownName');
              return (
                <li key={id} className="flex items-center gap-3 py-1 ps-3 pe-1">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <UserRoundIcon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    {guardian ? (
                      <>
                        <span className="font-medium">{guardian.full_name}</span>
                        {guardian.relationship && (
                          <span className="text-text-secondary"> · {guardian.relationship}</span>
                        )}
                        {guardian.phone && (
                          <span className="block text-caption text-text-secondary">
                            {formatPhone(guardian.phone, config)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="block h-3 w-24 rounded-sm bg-muted" aria-hidden />
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 p-0 text-destructive md:size-8"
                    onClick={() => removeSelected(id)}
                    aria-label={t('form.guardians.removeAction', { name })}
                  >
                    <CircleMinusIcon className="size-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Label htmlFor="student-form-guardian-search">{t('form.guardians.searchLabel')}</Label>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
        <Input
          id="student-form-guardian-search"
          className="ps-10"
          placeholder={t('form.guardians.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {debouncedSearch.trim() !== '' && (
        <ul
          className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border-subtle p-1"
          aria-live="polite"
        >
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
            <li className="px-2 py-1 text-text-secondary">{t('form.guardians.noResults')}</li>
          )}
          {searchQuery.data?.data.map((guardian) => (
            <li key={guardian.id}>
              <label
                htmlFor={`guardian-result-${guardian.id}`}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 hover:bg-muted md:min-h-8"
              >
                <Checkbox
                  id={`guardian-result-${guardian.id}`}
                  checked={selectedIds.includes(guardian.id)}
                  onCheckedChange={() => toggleSelected(guardian.id)}
                />
                <span>
                  {guardian.full_name}
                  {guardian.phone && (
                    <span className="text-text-secondary">
                      {' · '}
                      {formatPhone(guardian.phone, config)}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {!addingNew ? (
        <Button
          type="button"
          variant="outline"
          className="w-full md:w-auto"
          onClick={() => setAddingNew(true)}
        >
          <UserPlusIcon className="size-4" aria-hidden />
          {t('form.guardians.addNewAction')}
        </Button>
      ) : (
        <div className="grid gap-4 rounded-md border border-border-subtle p-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="student-form-new-guardian-name">
              {t('form.guardians.newGuardian.nameLabel')}{' '}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </Label>
            <Input
              id="student-form-new-guardian-name"
              value={draft.full_name}
              onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="student-form-new-guardian-relationship">
              {t('form.guardians.newGuardian.relationshipLabel')}
            </Label>
            <Input
              id="student-form-new-guardian-relationship"
              value={draft.relationship}
              onChange={(event) => setDraft({ ...draft, relationship: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="student-form-new-guardian-phone">
              {t('form.guardians.newGuardian.phoneLabel')}
            </Label>
            <PhoneInput
              id="student-form-new-guardian-phone"
              value={draft.phone}
              config={config}
              onValueChange={(value) => setDraft({ ...draft, phone: value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="student-form-new-guardian-email">
              {t('form.guardians.newGuardian.emailLabel')}
            </Label>
            <Input
              id="student-form-new-guardian-email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </div>
          {draftError && (
            <p role="alert" className="text-destructive md:col-span-2">
              {draftError}
            </p>
          )}
          <div className="flex gap-2 md:col-span-2">
            <Button
              type="button"
              variant="outline"
              loading={createGuardian.isPending}
              onClick={handleCreateGuardian}
            >
              {t('form.guardians.newGuardian.saveAction')}
            </Button>
            <Button
              type="button"
              variant="ghost"
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
