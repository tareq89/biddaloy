/**
 * Editable band table — [20.3.1]. An admin types a whole scale as a
 * sequence of `Enter`s: `Enter` in a row's last cell appends a new band
 * whose `percent_from` continues from the previous band's `percent_to`
 * (D2's contiguous-by-default authoring model). `Tab` moves cell to cell
 * using the table's natural DOM order — no custom focus management
 * needed for that part.
 *
 * Deleting a band leaves the resulting gap visible rather than silently
 * closing it — `-coverage-bar.tsx` is what makes that gap impossible to
 * miss, and the admin decides how (or whether) to close it, per the
 * issue's own "the admin decides" line.
 *
 * [31.4.marks-4b] Kit table on desktop, one card per band on a phone
 * (exactly one of the two is mounted); numbers show the tenant's numerals
 * and accept either digit system; a fail band has no GPA.
 */
import {
  Button,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@biddaloy/ui/components';
import type { BandInput } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, parseNumber, renderDigits } from '@biddaloy/ui/utils';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

import { useIsMobile } from './-use-is-mobile';

export interface BandEditorProps {
  bands: BandInput[];
  onChange: (bands: BandInput[]) => void;
  /** Viewer may not manage scales: everything disabled, no add row. */
  readOnly?: boolean;
}

function nextSequence(bands: BandInput[]): number {
  return bands.reduce((max, band) => Math.max(max, band.sequence), 0) + 1;
}

export function emptyBandAfter(bands: BandInput[]): BandInput {
  const previous = bands[bands.length - 1];
  const percentFrom = previous ? Math.min(previous.percent_to + 1, 100) : 0;
  return {
    percent_from: percentFrom,
    percent_to: 100,
    grade: '',
    gpa: null,
    is_fail: false,
    sequence: nextSequence(bands),
    comment: null,
  };
}

/** A numeric cell: shows the tenant's numerals, accepts either digit system.
 * A draft string lets "3." be typed on the way to "3.5"; `null` (cleared)
 * is reported as `null`, an unparsable draft is ignored until it parses. */
function NumberCell({
  id,
  value,
  onValue,
  label,
  disabled,
  placeholder,
  className,
}: {
  id?: string;
  value: number | null | undefined;
  onValue: (value: number | null) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { numerals } = useRegionConfig();
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown =
    draft ?? (value === null || value === undefined ? '' : renderDigits(String(value), numerals));
  return (
    <Input
      {...(id ? { id } : {})}
      type="text"
      inputMode="decimal"
      {...(label ? { 'aria-label': label } : {})}
      disabled={disabled ?? false}
      placeholder={placeholder}
      className={`text-end tabular-nums ${className ?? 'w-20'}`}
      value={shown}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw.trim() === '') {
          onValue(null);
          return;
        }
        try {
          onValue(parseNumber(raw));
        } catch {
          // Not a number yet ("3." on the way to "3.5") — keep the draft, wait.
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** Renders `<k>…</k>` markers of a translated string as `<kbd>`. */
function KeyboardHint({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<k>.*?<\/k>)/).map((part, i) =>
        part.startsWith('<k>') ? (
          <kbd key={i} className="rounded-sm border border-border-subtle bg-muted px-1 font-sans">
            {part.slice(3, -4)}
          </kbd>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function BandEditor({ bands, onChange, readOnly = false }: BandEditorProps) {
  const { t } = useTranslation('grading');
  const config = useRegionConfig();
  const isMobile = useIsMobile();

  function updateBand(index: number, patch: Partial<BandInput>) {
    const next = bands.map((band, i) => (i === index ? { ...band, ...patch } : band));
    onChange(next);
  }

  function removeBand(index: number) {
    onChange(bands.filter((_, i) => i !== index));
  }

  function addBand() {
    onChange([...bands, emptyBandAfter(bands)]);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    // Enter on the last row appends a new band continuing from this
    // row's percent_to — a mid-table row's Enter just confirms the
    // field, matching a native form's usual behaviour.
    if (event.key === 'Enter' && index === bands.length - 1) {
      event.preventDefault();
      addBand();
    }
  }

  const rowNumber = (index: number) => formatNumber(index + 1, config);
  const cellLabel = (index: number, column: string) =>
    t('bandEditor.cellLabel', { row: rowNumber(index), column });

  // A cleared from/to has no meaning (required), so it keeps the old value.
  const setRange =
    (index: number, key: 'percent_from' | 'percent_to') => (value: number | null) => {
      if (value !== null) updateBand(index, { [key]: value });
    };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        <fieldset disabled={readOnly} className="contents">
          <ul className="flex flex-col gap-3">
            {bands.map((band, index) => (
              <li
                key={band.sequence}
                className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-h3">
                    {t(band.grade.trim() ? 'bandEditor.cardTitle' : 'bandEditor.cardTitleNoGrade', {
                      grade: band.grade,
                      from: formatNumber(band.percent_from, config),
                      to: formatNumber(band.percent_to, config),
                    })}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-destructive"
                    aria-label={cellLabel(index, t('bandEditor.delete'))}
                    onClick={() => removeBand(index)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`band-${band.sequence}-from`}>
                      {t('bandEditor.columnFrom')}
                    </Label>
                    <NumberCell
                      id={`band-${band.sequence}-from`}
                      value={band.percent_from}
                      onValue={setRange(index, 'percent_from')}
                      className="h-11 w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`band-${band.sequence}-to`}>{t('bandEditor.columnTo')}</Label>
                    <NumberCell
                      id={`band-${band.sequence}-to`}
                      value={band.percent_to}
                      onValue={setRange(index, 'percent_to')}
                      className="h-11 w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`band-${band.sequence}-grade`}>
                      {t('bandEditor.columnGrade')}
                    </Label>
                    <Input
                      id={`band-${band.sequence}-grade`}
                      className="h-11"
                      value={band.grade}
                      onChange={(event) => updateBand(index, { grade: event.target.value })}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`band-${band.sequence}-gpa`}>{t('bandEditor.columnGpa')}</Label>
                    <NumberCell
                      id={`band-${band.sequence}-gpa`}
                      value={band.gpa}
                      onValue={(gpa) => updateBand(index, { gpa })}
                      disabled={band.is_fail ?? false}
                      placeholder="—"
                      className="h-11 w-full"
                    />
                  </div>
                </div>
                <div className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={`band-${band.sequence}-fail`}
                    checked={band.is_fail ?? false}
                    onCheckedChange={(checked) =>
                      updateBand(
                        index,
                        checked === true ? { is_fail: true, gpa: null } : { is_fail: false },
                      )
                    }
                  />
                  <Label htmlFor={`band-${band.sequence}-fail`}>{t('bandEditor.columnFail')}</Label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`band-${band.sequence}-comment`}>
                    {t('bandEditor.columnComment')}
                  </Label>
                  <Input
                    id={`band-${band.sequence}-comment`}
                    className="h-11"
                    value={band.comment ?? ''}
                    onChange={(event) => updateBand(index, { comment: event.target.value || null })}
                  />
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
        {!readOnly && (
          <Button type="button" variant="outline" className="h-11 w-full" onClick={addBand}>
            <PlusIcon aria-hidden="true" />
            {t('bandEditor.addBand')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
        <fieldset disabled={readOnly} className="contents">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('bandEditor.columnRow')}</TableHead>
                <TableHead className="text-end">{t('bandEditor.columnFrom')}</TableHead>
                <TableHead className="text-end">{t('bandEditor.columnTo')}</TableHead>
                <TableHead>{t('bandEditor.columnGrade')}</TableHead>
                <TableHead className="text-end">{t('bandEditor.columnGpa')}</TableHead>
                <TableHead>{t('bandEditor.columnFail')}</TableHead>
                <TableHead>{t('bandEditor.columnComment')}</TableHead>
                <TableHead>{t('bandEditor.columnActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bands.map((band, index) => (
                <TableRow key={band.sequence}>
                  <TableCell className="tabular-nums">{rowNumber(index)}</TableCell>
                  <TableCell className="text-end">
                    <NumberCell
                      label={cellLabel(index, t('bandEditor.columnFrom'))}
                      value={band.percent_from}
                      onValue={setRange(index, 'percent_from')}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <NumberCell
                      label={cellLabel(index, t('bandEditor.columnTo'))}
                      value={band.percent_to}
                      onValue={setRange(index, 'percent_to')}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-24"
                      aria-label={cellLabel(index, t('bandEditor.columnGrade'))}
                      value={band.grade}
                      onChange={(event) => updateBand(index, { grade: event.target.value })}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <NumberCell
                      label={cellLabel(index, t('bandEditor.columnGpa'))}
                      value={band.gpa}
                      onValue={(gpa) => updateBand(index, { gpa })}
                      disabled={band.is_fail ?? false}
                      placeholder="—"
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={cellLabel(index, t('bandEditor.columnFail'))}
                      checked={band.is_fail ?? false}
                      onCheckedChange={(checked) =>
                        updateBand(
                          index,
                          checked === true ? { is_fail: true, gpa: null } : { is_fail: false },
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-full"
                      aria-label={cellLabel(index, t('bandEditor.columnComment'))}
                      value={band.comment ?? ''}
                      onChange={(event) =>
                        updateBand(index, { comment: event.target.value || null })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label={cellLabel(index, t('bandEditor.delete'))}
                          onClick={() => removeBand(index)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('bandEditor.delete')}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </fieldset>
        {!readOnly && (
          <div className="flex items-center justify-between gap-4 border-t border-border-subtle px-4 py-3">
            <Button type="button" variant="outline" onClick={addBand}>
              <PlusIcon aria-hidden="true" />
              {t('bandEditor.addBand')}
            </Button>
            <p className="text-caption text-text-secondary">
              <KeyboardHint text={t('bandEditor.enterHint')} />
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
