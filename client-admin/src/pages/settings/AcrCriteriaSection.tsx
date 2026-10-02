/**
 * [28.4.1] "ACR criteria" settings section — an editable, ordered list.
 * Save PUTs the whole list, which the server stores as a NEW version:
 * ACRs already started keep the version they began with, so the section
 * says "applies to new ACRs only" both before and after saving (D1).
 *
 * Rows live in plain local state (not react-hook-form): the list is
 * add/remove/reorder, and the only validation is "code + both names
 * filled, codes unique".
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useAcrCriteria,
  useSaveAcrCriteria,
  type AcrCriterion,
  type AcrCriterionInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FormSection, FormShell, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { useBlocker } from '@tanstack/react-router';
import * as React from 'react';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

type Row = Pick<AcrCriterion, 'block' | 'code' | 'label_en' | 'label_bn'> & { key: string };

let rowSeq = 0;
const nextKey = () => `new-${(rowSeq += 1)}`;

function toRows(criteria: readonly AcrCriterion[]): Row[] {
  return [...criteria]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      key: c.id,
      block: c.block,
      code: c.code,
      label_en: c.label_en,
      label_bn: c.label_bn,
    }));
}

export function AcrCriteriaSection() {
  const { t } = useTranslation('evaluations');
  const query = useAcrCriteria();
  // Owned here, not in the editor: a saved new version remounts the editor
  // (key below), which would otherwise drop the "saved" notice.
  const save = useSaveAcrCriteria();
  return (
    <section aria-labelledby="acr-criteria-heading" className="flex flex-col gap-3">
      <h2 id="acr-criteria-heading" className="text-base font-semibold">
        {t('acr.criteriaSettings.title')}
      </h2>
      {query.isError ? (
        <ErrorState
          message={t('acr.criteriaSettings.loadError')}
          onRetry={() => void query.refetch()}
        />
      ) : !query.data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <CriteriaEditor
          // A new server version (after save) resets the editor to it.
          key={`${query.data.id ?? 'default'}:${query.data.version}`}
          version={query.data.version}
          criteria={query.data.criteria}
          save={save}
        />
      )}
    </section>
  );
}

function CriteriaEditor({
  version,
  criteria,
  save,
}: {
  version: number;
  criteria: readonly AcrCriterion[];
  save: ReturnType<typeof useSaveAcrCriteria>;
}) {
  const { t } = useTranslation('evaluations');
  const initial = React.useMemo(() => toRows(criteria), [criteria]);
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [submitCount, setSubmitCount] = React.useState(0);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  useWarnUnsavedChanges(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const patch = (index: number, change: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitCount((n) => n + 1);
    const codes = rows.map((r) => r.code.trim());
    if (rows.some((r) => !r.code.trim() || !r.label_en.trim() || !r.label_bn.trim())) {
      setError(t('acr.criteriaSettings.errorRequired'));
      return;
    }
    if (new Set(codes).size !== codes.length) {
      setError(t('acr.criteriaSettings.errorDuplicateCode'));
      return;
    }
    setError(null);
    const body: AcrCriterionInput[] = rows.map((r, i) => ({
      block: r.block,
      code: r.code.trim(),
      label_en: r.label_en.trim(),
      label_bn: r.label_bn.trim(),
      sort_order: i + 1,
    }));
    save.mutate(body);
  }

  return (
    <>
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('acr.criteriaSettings.unsavedDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('acr.criteriaSettings.unsavedDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('acr.criteriaSettings.unsavedDialog.stay')}
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('acr.criteriaSettings.unsavedDialog.leave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FormShell
        errors={error ? [{ field: 'acr-criteria-code-0', message: error }] : []}
        submitCount={submitCount}
        onSubmit={onSubmit}
      >
        <FormSection legend={t('acr.criteriaSettings.version', { version })}>
          <p className="text-sm text-muted-foreground">{t('acr.criteriaSettings.description')}</p>
          <p role="note" className="text-sm font-medium">
            {t('acr.criteriaSettings.appliesToNewOnly')}
          </p>
          <ol className="flex flex-col gap-4">
            {rows.map((row, i) => (
              <li
                key={row.key}
                className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
              >
                <label className="grid gap-1 text-sm">
                  {t('acr.criteriaSettings.codeLabel')}
                  <Input
                    id={`acr-criteria-code-${i}`}
                    value={row.code}
                    onChange={(e) => patch(i, { code: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('acr.criteriaSettings.blockLabel')}
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    value={row.block}
                    onChange={(e) => patch(i, { block: e.target.value as Row['block'] })}
                  >
                    <option value="BLOCK_2">{t('acr.criteriaSettings.block2')}</option>
                    <option value="BLOCK_3">{t('acr.criteriaSettings.block3')}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  {t('acr.criteriaSettings.labelEn')}
                  <Input
                    value={row.label_en}
                    onChange={(e) => patch(i, { label_en: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('acr.criteriaSettings.labelBn')}
                  <Input
                    value={row.label_bn}
                    onChange={(e) => patch(i, { label_bn: e.target.value })}
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    {t('acr.criteriaSettings.moveUp')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    {t('acr.criteriaSettings.moveDown')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  >
                    {t('acr.criteriaSettings.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  { key: nextKey(), block: 'BLOCK_2', code: '', label_en: '', label_bn: '' },
                ])
              }
            >
              {t('acr.criteriaSettings.add')}
            </Button>
          </div>
        </FormSection>

        <Button type="submit" loading={save.isPending}>
          {t('acr.criteriaSettings.save')}
        </Button>
        {save.isSuccess && !dirty && (
          <p role="status">{t('acr.criteriaSettings.saved', { version: save.data.version })}</p>
        )}
        {save.isError && <MutationErrorMessage error={save.error} />}
      </FormShell>
    </>
  );
}
