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
 */
import {
  Button,
  Checkbox,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import type { BandInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface BandEditorProps {
  bands: BandInput[];
  onChange: (bands: BandInput[]) => void;
}

function nextSequence(bands: BandInput[]): number {
  return bands.reduce((max, band) => Math.max(max, band.sequence), 0) + 1;
}

function emptyBandAfter(bands: BandInput[]): BandInput {
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

export function BandEditor({ bands, onChange }: BandEditorProps) {
  const { t } = useTranslation('grading');

  function updateBand(index: number, patch: Partial<BandInput>) {
    const next = bands.map((band, i) => (i === index ? { ...band, ...patch } : band));
    onChange(next);
  }

  function removeBand(index: number) {
    onChange(bands.filter((_, i) => i !== index));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    // Enter on the last row appends a new band continuing from this
    // row's percent_to — a mid-table row's Enter just confirms the
    // field, matching a native form's usual behaviour.
    if (event.key === 'Enter' && index === bands.length - 1) {
      event.preventDefault();
      onChange([...bands, emptyBandAfter(bands)]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('bandEditor.columnFrom')}</TableHead>
            <TableHead>{t('bandEditor.columnTo')}</TableHead>
            <TableHead>{t('bandEditor.columnGrade')}</TableHead>
            <TableHead>{t('bandEditor.columnGpa')}</TableHead>
            <TableHead>{t('bandEditor.columnFail')}</TableHead>
            <TableHead>{t('bandEditor.columnComment')}</TableHead>
            <TableHead>{t('bandEditor.columnActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bands.map((band, index) => (
            <TableRow key={band.sequence}>
              <TableCell>
                <Input
                  type="number"
                  aria-label={t('bandEditor.columnFrom')}
                  value={band.percent_from}
                  onChange={(event) =>
                    updateBand(index, { percent_from: Number(event.target.value) })
                  }
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  aria-label={t('bandEditor.columnTo')}
                  value={band.percent_to}
                  onChange={(event) =>
                    updateBand(index, { percent_to: Number(event.target.value) })
                  }
                />
              </TableCell>
              <TableCell>
                <Input
                  aria-label={t('bandEditor.columnGrade')}
                  value={band.grade}
                  onChange={(event) => updateBand(index, { grade: event.target.value })}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  aria-label={t('bandEditor.columnGpa')}
                  value={band.gpa ?? ''}
                  onChange={(event) =>
                    updateBand(index, {
                      gpa: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                />
              </TableCell>
              <TableCell>
                <Checkbox
                  aria-label={t('bandEditor.columnFail')}
                  checked={band.is_fail ?? false}
                  onCheckedChange={(checked) => updateBand(index, { is_fail: checked === true })}
                />
              </TableCell>
              <TableCell>
                <Input
                  aria-label={t('bandEditor.columnComment')}
                  value={band.comment ?? ''}
                  onChange={(event) => updateBand(index, { comment: event.target.value || null })}
                />
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  onClick={() => removeBand(index)}
                  className="text-sm font-medium text-destructive underline"
                >
                  {t('bandEditor.delete')}
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...bands, emptyBandAfter(bands)])}
      >
        {t('bandEditor.addBand')}
      </Button>
    </div>
  );
}
