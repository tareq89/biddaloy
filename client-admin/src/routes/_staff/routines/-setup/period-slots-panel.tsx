/**
 * [21.7.1] "Period slots" panel — a selected shift's whole period-slot set,
 * edited as rows (`sequence · kind · name · starts_at · ends_at`) and saved
 * in one `PUT .../period-slots` (`ReplacePeriodSlotsDto`, whole-set replace
 * — see `period-slots.service.ts`).
 *
 * D7 changeover gap: pressing `Enter` in the last row's `ends_at` field
 * appends a new row whose `starts_at` is pre-filled with that row's
 * `ends_at` plus `TenantSettings.routine.defaultChangeoverMinutes`
 * (`changeoverGapMinutes` prop, read from `RoutineSettingsPanel`'s already
 * loaded settings query rather than a second fetch). It's a suggestion,
 * not a lock — every field stays a plain editable input, so a manual edit
 * is never silently overwritten (D7's own acceptance criterion).
 *
 * `kind: BREAK` rows hide the "name" concept — a break has no subject to
 * name — and get a visually distinct row background, satisfying "BREAK
 * hides subject/teacher concepts entirely, visually distinct."
 *
 * The timeline strip below the table is a plain flex bar spanning the
 * shift's day window, one block per slot sized by its duration — enough to
 * make a missing/short period visually obvious while typing, without
 * pulling in a calendar/gantt component for a same-day, single-row strip.
 */
import { Button, Input } from '@biddaloy/ui/components';
import {
  useReplacePeriodSlots,
  usePeriodSlots,
  type PeriodSlotItem,
  type PeriodSlotKind,
  type Shift,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface PeriodSlotsPanelProps {
  shift: Shift | undefined;
  changeoverGapMinutes: number;
}

export function PeriodSlotsPanel({ shift, changeoverGapMinutes }: PeriodSlotsPanelProps) {
  const { t } = useTranslation('routines');
  const slotsQuery = usePeriodSlots(shift?.id);
  const replaceSlots = useReplacePeriodSlots(shift?.id ?? '');

  const [rows, setRows] = React.useState<PeriodSlotItem[]>([]);
  const loadedShiftId = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (!shift || slotsQuery.data === undefined) return;
    if (loadedShiftId.current === shift.id) return;
    loadedShiftId.current = shift.id;
    setRows(
      slotsQuery.data.map((slot) => ({
        sequence: slot.sequence,
        kind: slot.kind,
        name: slot.name,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
      })),
    );
  }, [shift, slotsQuery.data]);

  function updateRow(index: number, patch: Partial<PeriodSlotItem>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function appendRow(afterIndex: number) {
    setRows((current) => {
      const previous = current[afterIndex];
      const startsAt = previous
        ? minutesToTime(timeToMinutes(previous.ends_at) + changeoverGapMinutes)
        : (shift?.day_starts_at ?? '08:00');
      const next: PeriodSlotItem = {
        sequence: current.length,
        kind: 'CLASS',
        name: null,
        starts_at: startsAt,
        ends_at: minutesToTime(timeToMinutes(startsAt) + 40),
      };
      return [...current, next];
    });
  }

  function removeRow(index: number) {
    setRows((current) =>
      current.filter((_, i) => i !== index).map((row, i) => ({ ...row, sequence: i })),
    );
  }

  function handleEndsAtKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (index === rows.length - 1) appendRow(index);
  }

  function handleSave() {
    if (!shift) return;
    replaceSlots.mutate(rows);
  }

  if (!shift) {
    return <p className="text-sm text-muted-foreground">{t('periodSlotsPanel.selectShift')}</p>;
  }

  const dayStart = timeToMinutes(shift.day_starts_at);
  const dayEnd = timeToMinutes(shift.day_ends_at);
  const dayMinutes = Math.max(dayEnd - dayStart, 1);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">
        {t('periodSlotsPanel.legend', { shiftName: shift.name })}
      </h2>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 font-normal">{t('periodSlotsPanel.sequence')}</th>
            <th className="py-1.5 font-normal">{t('periodSlotsPanel.kind')}</th>
            <th className="py-1.5 font-normal">{t('periodSlotsPanel.name')}</th>
            <th className="py-1.5 font-normal">{t('periodSlotsPanel.startsAt')}</th>
            <th className="py-1.5 font-normal">{t('periodSlotsPanel.endsAt')}</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={row.kind === 'BREAK' ? 'border-b bg-muted' : 'border-b'}>
              <td className="py-1.5">{row.sequence}</td>
              <td className="py-1.5">
                <select
                  className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                  value={row.kind}
                  onChange={(event) => {
                    const kind = event.target.value as PeriodSlotKind;
                    updateRow(index, { kind, name: kind === 'BREAK' ? null : (row.name ?? null) });
                  }}
                >
                  <option value="CLASS">{t('periodSlotsPanel.kindClass')}</option>
                  <option value="BREAK">{t('periodSlotsPanel.kindBreak')}</option>
                </select>
              </td>
              <td className="py-1.5">
                {row.kind === 'BREAK' ? (
                  <span className="text-muted-foreground">{t('periodSlotsPanel.breakNoName')}</span>
                ) : (
                  <Input
                    aria-label={t('periodSlotsPanel.name')}
                    value={row.name ?? ''}
                    onChange={(event) => updateRow(index, { name: event.target.value })}
                  />
                )}
              </td>
              <td className="py-1.5">
                <Input
                  aria-label={t('periodSlotsPanel.startsAt')}
                  type="time"
                  value={row.starts_at}
                  onChange={(event) => updateRow(index, { starts_at: event.target.value })}
                />
              </td>
              <td className="py-1.5">
                <Input
                  aria-label={t('periodSlotsPanel.endsAt')}
                  type="time"
                  value={row.ends_at}
                  onChange={(event) => updateRow(index, { ends_at: event.target.value })}
                  onKeyDown={(event) => handleEndsAtKeyDown(event, index)}
                />
              </td>
              <td className="py-1.5 text-right">
                <Button type="button" variant="outline" size="sm" onClick={() => removeRow(index)}>
                  {t('delete.action')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Button type="button" variant="outline" onClick={() => appendRow(rows.length - 1)}>
        {t('periodSlotsPanel.addRowAction')}
      </Button>

      {/* Timeline strip: one block per slot, positioned/sized by its share
          of the shift's day window — a gap between two blocks is a missing
          period, visible at a glance while still typing rows above. */}
      <div
        role="img"
        aria-label={t('periodSlotsPanel.timelineLabel')}
        className="relative h-6 w-full overflow-hidden rounded-md border border-border-subtle bg-muted"
      >
        {rows.map((row, index) => {
          const start = timeToMinutes(row.starts_at);
          const end = timeToMinutes(row.ends_at);
          const widthPercent = (Math.max(end - start, 0) / dayMinutes) * 100;
          const offsetPercent = (Math.max(start - dayStart, 0) / dayMinutes) * 100;
          return (
            <div
              key={index}
              title={`${row.starts_at}–${row.ends_at}`}
              className={
                row.kind === 'BREAK'
                  ? 'absolute h-6 bg-muted-foreground/40'
                  : 'absolute h-6 bg-primary/60'
              }
              style={{ left: `${offsetPercent}%`, width: `${widthPercent}%` }}
            />
          );
        })}
      </div>

      <Button type="button" onClick={handleSave} loading={replaceSlots.isPending}>
        {t('save.action')}
      </Button>
      {replaceSlots.isSuccess && <p role="status">{t('save.success')}</p>}
      {replaceSlots.isError && <MutationErrorMessage error={replaceSlots.error} />}
    </section>
  );
}
