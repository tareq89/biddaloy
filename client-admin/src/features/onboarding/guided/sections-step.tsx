import { Button, Card, ErrorState, Input, Label, Skeleton } from '@biddaloy/ui/components';
import {
  useAllClasses,
  useClassSections,
  useCreateSection,
  type ClassWithCounts,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { StepNav } from './step-nav';

const MAX_SECTIONS = 10;
const LETTERS = 'ABCDEFGHIJ'.split('');

type RowRun = () => Promise<boolean>;

/**
 * One class: a 1-10 stepper and the letters it will have. Existing sections are kept
 * (the stepper cannot go below them and the default is "no change"); only the missing
 * letters are created, in order, one request each.
 */
function ClassRow({
  cls,
  onMissing,
  register,
}: {
  cls: ClassWithCounts;
  onMissing: (classId: string, missing: number) => void;
  register: (classId: string, run: RowRun) => void;
}) {
  const { t } = useTranslation('onboardingSetup');
  const sections = useClassSections(cls.id);
  const create = useCreateSection(cls.id);
  const existing = React.useMemo(
    () => (sections.data ?? []).map((s) => s.section_name),
    [sections.data],
  );
  // What is typed, as text, so the field can be cleared while typing; it snaps into 1-10 on blur.
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const floor = Math.max(existing.length, 1);
  const count = Math.min(MAX_SECTIONS, Math.max(floor, Math.trunc(Number(draft)) || floor));
  const letters = LETTERS.slice(0, count);
  const missing = letters.filter((l) => !existing.includes(l));

  // Creates what is missing, stopping at the first failure; a retry resumes there
  // (the refetched section list no longer counts the letters that went through).
  const missingRef = React.useRef(missing);
  missingRef.current = missing;
  const mutateRef = React.useRef(create.mutateAsync);
  mutateRef.current = create.mutateAsync;
  const run = React.useCallback<RowRun>(async () => {
    setError(false);
    setDone(0);
    for (const [i, letter] of missingRef.current.entries()) {
      try {
        await mutateRef.current({ section_name: letter });
        setDone(i + 1);
      } catch {
        setError(true);
        return false;
      }
    }
    return true;
  }, []);

  React.useEffect(() => onMissing(cls.id, sections.data ? missing.length : 0));
  React.useEffect(() => register(cls.id, run), [cls.id, register, run]);

  const inputId = `guided-sections-${cls.id}`;
  return (
    <li className="flex flex-col gap-2 border-b border-border-subtle py-3 last:border-b-0 md:flex-row md:items-center md:gap-4">
      <span className="font-medium md:w-48">{cls.name}</span>
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId}>{t('guided.sections.count', { defaultValue: 'Sections' })}</Label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={floor}
          max={MAX_SECTIONS}
          value={draft ?? String(count)}
          disabled={!sections.data || create.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(String(count))}
          className="w-20"
        />
      </div>
      <span
        className="text-text-secondary"
        aria-label={t('guided.sections.perClass', { className: cls.name })}
      >
        {letters.join(', ')}
      </span>
      <div className="md:ms-auto" aria-live="polite">
        {create.isPending && (
          <span className="text-caption text-text-secondary">
            {done + 1} / {missing.length}
          </span>
        )}
        {error && (
          <span className="flex items-center gap-2 text-sm text-destructive" role="alert">
            {t('saveError')}
            <Button type="button" size="sm" variant="outline" onClick={() => void run()}>
              {t('guided.sections.retry', { defaultValue: 'Retry' })}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

/** Step 3: one row per class; "Create sections" runs every row, a failed row keeps its Retry. */
export function SectionsStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation('onboardingSetup');
  const classes = useAllClasses();
  const [missingBy, setMissingBy] = React.useState<Record<string, number>>({});
  const runs = React.useRef(new Map<string, RowRun>());
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const toCreate = Object.values(missingBy).reduce((a, b) => a + b, 0);

  const onMissing = React.useCallback(
    (id: string, n: number) =>
      setMissingBy((prev) => (prev[id] === n ? prev : { ...prev, [id]: n })),
    [],
  );
  const register = React.useCallback(
    (id: string, run: RowRun) => void runs.current.set(id, run),
    [],
  );

  async function primary() {
    if (toCreate === 0) return onDone();
    setBusy(true);
    setFailed(false);
    let ok = true;
    // In order; a failed row does not stop the others.
    for (const cls of classes.data ?? []) {
      if (!((missingBy[cls.id] ?? 0) > 0)) continue;
      ok = (await runs.current.get(cls.id)?.()) !== false && ok;
    }
    setBusy(false);
    if (ok) onDone();
    else setFailed(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-h2">{t('guided.sections.title')}</h2>
      <p className="text-text-secondary">{t('guided.sections.hint')}</p>
      {classes.isError ? (
        <ErrorState message={t('saveError')} onRetry={() => void classes.refetch()} />
      ) : !classes.data ? (
        <Skeleton aria-busy="true" className="h-44 w-full" />
      ) : classes.data.length === 0 ? (
        <Card padded role="status">
          {t('guided.sections.empty', {
            defaultValue: 'There are no classes yet. Go back and pick a curriculum first.',
          })}
        </Card>
      ) : (
        <Card padded>
          <ul>
            {classes.data.map((cls) => (
              <ClassRow key={cls.id} cls={cls} onMissing={onMissing} register={register} />
            ))}
          </ul>
        </Card>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('saveError')}
        </p>
      )}
      <StepNav
        onBack={onBack}
        onPrimary={() => void primary()}
        busy={busy}
        primaryLabel={
          toCreate > 0
            ? t('guided.sections.create', { defaultValue: 'Create sections' })
            : undefined
        }
      />
    </div>
  );
}
