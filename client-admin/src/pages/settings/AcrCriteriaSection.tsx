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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  TableCount,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@biddaloy/ui/components';
import {
  useAcrCriteria,
  useSaveAcrCriteria,
  type AcrCriterion,
  type AcrCriterionInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useBlocker } from '@tanstack/react-router';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  InfoIcon,
  PlusIcon,
} from 'lucide-react';
import * as React from 'react';

import { SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';
import { useIsPhone } from './use-is-phone';

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
  if (query.isError || !query.data) {
    return (
      <SettingsSection id="acr-criteria-section" title={t('acr.criteriaSettings.title')}>
        <div className="mt-4">
          {query.isError ? (
            <ErrorState
              message={t('acr.criteriaSettings.loadError')}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <div aria-busy="true" className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </div>
      </SettingsSection>
    );
  }
  return (
    <CriteriaEditor
      // A new server version (after save) resets the editor to it.
      key={`${query.data.id ?? 'default'}:${query.data.version}`}
      version={query.data.version}
      criteria={query.data.criteria}
      save={save}
    />
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
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const isPhone = useIsPhone();
  const initial = React.useMemo(() => toRows(criteria), [criteria]);
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  useWarnUnsavedChanges(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  // Any edit makes an earlier validation or save error stale.
  const edit = (update: (prev: Row[]) => Row[]) => {
    setError(null);
    save.reset();
    setRows(update);
  };
  const patch = (index: number, change: Partial<Row>) =>
    edit((prev) => prev.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const remove = (index: number) => edit((prev) => prev.filter((_, j) => j !== index));
  const move = (index: number, by: -1 | 1) =>
    edit((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      <SettingsSection
        id="acr-criteria-section"
        title={t('acr.criteriaSettings.title')}
        description={t('acr.criteriaSettings.description')}
        badge={
          <StatusBadge
            tone="info"
            label={t('acr.criteriaSettings.version', {
              version: formatNumber(version, regionConfig),
            })}
          />
        }
        onSubmit={onSubmit}
        saving={save.isPending}
        saveLabel={t('acr.criteriaSettings.save')}
        footerStart={
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              onClick={() =>
                edit((prev) => [
                  ...prev,
                  { key: nextKey(), block: 'BLOCK_2', code: '', label_en: '', label_bn: '' },
                ])
              }
            >
              <PlusIcon aria-hidden="true" />
              {t('acr.criteriaSettings.add')}
            </Button>
            {save.isSuccess && !dirty && (
              <p role="status" className="flex items-center gap-1.5 text-text-secondary">
                <CircleCheckIcon aria-hidden="true" className="size-4 text-status-paid-fg" />
                {t('acr.criteriaSettings.saved', {
                  version: formatNumber(save.data.version, regionConfig),
                })}
              </p>
            )}
            {save.isError && <SettingsMutationError error={save.error} />}
          </>
        }
      >
        <p role="note" className="mt-3 flex items-start gap-2 text-caption text-text-secondary">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('acr.criteriaSettings.appliesToNewOnly')}
        </p>
        <TooltipProvider delayDuration={300}>
          {isPhone ? (
            <ul className="mt-4 space-y-3">
              {rows.map((row, i) => (
                <PhoneRow
                  key={row.key}
                  row={row}
                  index={i}
                  last={i === rows.length - 1}
                  onPatch={(change) => patch(i, change)}
                  onMove={(by) => move(i, by)}
                  onRemove={() => remove(i)}
                />
              ))}
            </ul>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle">
              <table className="w-full text-start">
                <thead className="border-b border-border-subtle bg-muted text-label text-text-secondary">
                  <tr>
                    <th className="h-10 w-36 px-4 text-start font-medium">
                      {t('acr.criteriaSettings.codeLabel')}
                    </th>
                    <th className="h-10 w-56 px-4 text-start font-medium">
                      {t('acr.criteriaSettings.blockLabel')}
                    </th>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('acr.criteriaSettings.labelBn')}
                    </th>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('acr.criteriaSettings.labelEn')}
                    </th>
                    <th className="h-10 w-32 px-4 text-end font-medium">
                      {tCommon('table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rows.map((row, i) => (
                    <DesktopRow
                      key={row.key}
                      row={row}
                      index={i}
                      last={i === rows.length - 1}
                      onPatch={(change) => patch(i, change)}
                      onMove={(by) => move(i, by)}
                      onRemove={() => remove(i)}
                    />
                  ))}
                </tbody>
              </table>
              <div className="border-t border-border-subtle px-4 py-3">
                <TableCount total={rows.length} />
              </div>
            </div>
          )}
        </TooltipProvider>
        {isPhone && (
          <div className="mt-3">
            <TableCount total={rows.length} />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 flex items-center gap-1 text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
            {error}
          </p>
        )}
      </SettingsSection>
    </>
  );
}

interface RowProps {
  row: Row;
  index: number;
  last: boolean;
  onPatch: (change: Partial<Row>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** The accessible name of a row's controls: a blank new row has no code yet, so use its position. */
function useRowName(row: Row, index: number): string {
  const regionConfig = useRegionConfig();
  return row.code.trim() || formatNumber(index + 1, regionConfig);
}

function BlockSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: Row['block'];
  onChange: (value: Row['block']) => void;
}) {
  const { t } = useTranslation('evaluations');
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Row['block'])}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="BLOCK_2">{t('acr.criteriaSettings.block2')}</SelectItem>
        <SelectItem value="BLOCK_3">{t('acr.criteriaSettings.block3')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function DesktopRow({ row, index, last, onPatch, onMove, onRemove }: RowProps) {
  const { t } = useTranslation('evaluations');
  const name = useRowName(row, index);
  const iconButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${label}: ${name}`}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <tr>
      <td className="px-4 py-1.5">
        <Input
          id={`acr-criteria-code-${index}`}
          aria-label={`${t('acr.criteriaSettings.codeLabel')}: ${name}`}
          value={row.code}
          onChange={(e) => onPatch({ code: e.target.value })}
        />
      </td>
      <td className="px-4 py-1.5">
        <BlockSelect
          id={`acr-criteria-block-${index}`}
          label={`${t('acr.criteriaSettings.blockLabel')}: ${name}`}
          value={row.block}
          onChange={(block) => onPatch({ block })}
        />
      </td>
      <td className="px-4 py-1.5">
        <Input
          aria-label={`${t('acr.criteriaSettings.labelBn')}: ${name}`}
          value={row.label_bn}
          onChange={(e) => onPatch({ label_bn: e.target.value })}
        />
      </td>
      <td className="px-4 py-1.5">
        <Input
          aria-label={`${t('acr.criteriaSettings.labelEn')}: ${name}`}
          value={row.label_en}
          onChange={(e) => onPatch({ label_en: e.target.value })}
        />
      </td>
      <td className="px-4 py-1.5">
        <div className="flex justify-end">
          {iconButton(
            t('acr.criteriaSettings.moveUp'),
            <ArrowUpIcon aria-hidden="true" className="text-text-secondary" />,
            () => onMove(-1),
            index === 0,
          )}
          {iconButton(
            t('acr.criteriaSettings.moveDown'),
            <ArrowDownIcon aria-hidden="true" className="text-text-secondary" />,
            () => onMove(1),
            last,
          )}
          {iconButton(
            t('acr.criteriaSettings.remove'),
            <CircleMinusIcon aria-hidden="true" className="text-destructive" />,
            onRemove,
          )}
        </div>
      </td>
    </tr>
  );
}

function PhoneRow({ row, index, last, onPatch, onMove, onRemove }: RowProps) {
  const { t } = useTranslation('evaluations');
  const name = useRowName(row, index);
  const actionClass =
    'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-medium hover:bg-muted disabled:opacity-50';
  return (
    <li className="rounded-lg border border-border-subtle">
      <div className="grid grid-cols-3 gap-4 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`acr-criteria-code-${index}`}>
            {t('acr.criteriaSettings.codeLabel')}
          </Label>
          <Input
            id={`acr-criteria-code-${index}`}
            aria-label={`${t('acr.criteriaSettings.codeLabel')}: ${name}`}
            value={row.code}
            onChange={(e) => onPatch({ code: e.target.value })}
          />
        </div>
        <div className="col-span-2 grid gap-1.5">
          <Label htmlFor={`acr-criteria-block-${index}`}>
            {t('acr.criteriaSettings.blockLabel')}
          </Label>
          <BlockSelect
            id={`acr-criteria-block-${index}`}
            label={`${t('acr.criteriaSettings.blockLabel')}: ${name}`}
            value={row.block}
            onChange={(block) => onPatch({ block })}
          />
        </div>
        <div className="col-span-3 grid gap-1.5">
          <Label htmlFor={`acr-criteria-bn-${index}`}>{t('acr.criteriaSettings.labelBn')}</Label>
          <Input
            id={`acr-criteria-bn-${index}`}
            aria-label={`${t('acr.criteriaSettings.labelBn')}: ${name}`}
            value={row.label_bn}
            onChange={(e) => onPatch({ label_bn: e.target.value })}
          />
        </div>
        <div className="col-span-3 grid gap-1.5">
          <Label htmlFor={`acr-criteria-en-${index}`}>{t('acr.criteriaSettings.labelEn')}</Label>
          <Input
            id={`acr-criteria-en-${index}`}
            aria-label={`${t('acr.criteriaSettings.labelEn')}: ${name}`}
            value={row.label_en}
            onChange={(e) => onPatch({ label_en: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center border-t border-border-subtle px-1">
        <button
          type="button"
          className={actionClass}
          aria-label={`${t('acr.criteriaSettings.moveUp')}: ${name}`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon aria-hidden="true" className="size-4" />
          {t('acr.criteriaSettings.moveUp')}
        </button>
        <button
          type="button"
          className={actionClass}
          aria-label={`${t('acr.criteriaSettings.moveDown')}: ${name}`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon aria-hidden="true" className="size-4" />
          {t('acr.criteriaSettings.moveDown')}
        </button>
        <button
          type="button"
          className={`${actionClass} text-destructive`}
          aria-label={`${t('acr.criteriaSettings.remove')}: ${name}`}
          onClick={onRemove}
        >
          <CircleMinusIcon aria-hidden="true" className="size-4" />
          {t('acr.criteriaSettings.remove')}
        </button>
      </div>
    </li>
  );
}
