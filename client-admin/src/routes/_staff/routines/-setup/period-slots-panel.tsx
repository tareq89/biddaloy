/**
 * [21.7.1] "Period times" panel — a selected shift's whole period-slot set,
 * edited as rows (`sequence · kind · name · starts_at · ends_at`) and saved
 * in one `PUT .../period-slots` (`ReplacePeriodSlotsDto`, whole-set replace
 * — see `period-slots.service.ts`).
 *
 * D7 changeover gap: "Add period" appends a row whose `starts_at` is the
 * previous row's `ends_at` plus `TenantSettings.routine.defaultChangeoverMinutes`
 * (`changeoverGapMinutes` prop, read from the already loaded settings query
 * rather than a second fetch). It's a suggestion, not a lock — every field
 * stays editable, so a manual edit is never silently overwritten.
 *
 * [31.4] Rows are checked as you type with the same three rules as
 * `PeriodSlotsService.validateSlots` (the server stays the authority):
 * ends before it starts, outside the shift's day, overlaps the row above.
 * A break may carry a name — the routine table shows it. The Enter-to-add
 * shortcut is gone (the time picker owns Enter); the add button applies the
 * same gap.
 *
 * The timeline strip is a plain bar spanning the shift's day window, one
 * block per slot sized by its duration — enough to make a missing or short
 * period obvious while typing.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimeInput,
  toast,
} from '@biddaloy/ui/components';
import {
  useReplacePeriodSlots,
  usePeriodSlots,
  type PeriodSlotItem,
  type PeriodSlotKind,
  type Shift,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { CircleAlertIcon, CircleMinusIcon, ClockIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

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

type RowError = 'endBeforeStart' | 'outsideShift' | 'overlapsPrevious';

export interface PeriodSlotsPanelProps {
  shifts: Shift[];
  shift: Shift | undefined;
  onSelectShift: (shiftId: string) => void;
  changeoverGapMinutes: number;
}

export function PeriodSlotsPanel({
  shifts,
  shift,
  onSelectShift,
  changeoverGapMinutes,
}: PeriodSlotsPanelProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const slotsQuery = usePeriodSlots(shift?.id);
  const replaceSlots = useReplacePeriodSlots(shift?.id ?? '');

  const [rows, setRows] = React.useState<PeriodSlotItem[]>([]);
  const loadedShiftId = React.useRef<string | undefined>(undefined);
  const loadedRows = React.useRef<PeriodSlotItem[]>([]);

  // [21.8.1] On a shift switch, `slotsQuery.data` is `undefined` until the
  // new shift's fetch resolves — clear `rows` for that window instead of
  // leaving the old shift's rows on screen. `ready` (below) blocks Save
  // for the same window, so a click there can never PUT the old shift's
  // rows onto the new shift's period-slots endpoint.
  React.useEffect(() => {
    if (!shift) return;
    if (loadedShiftId.current !== shift.id && slotsQuery.data === undefined) {
      setRows([]);
      return;
    }
    if (slotsQuery.data === undefined || loadedShiftId.current === shift.id) return;
    loadedShiftId.current = shift.id;
    // Numbered 1..n by order, so every screen (this editor, the routine
    // table, the phone list) shows the same period numbers.
    const loaded = [...slotsQuery.data]
      .sort((a, b) => a.sequence - b.sequence)
      .map((slot, index) => ({
        sequence: index + 1,
        kind: slot.kind,
        name: slot.name,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
      }));
    loadedRows.current = loaded;
    setRows(loaded);
  }, [shift, slotsQuery.data]);

  // `loadedShiftId.current === shift?.id` already proves the data for
  // this shift arrived — not `slotsQuery.isSuccess`, which flips to
  // `error` on a failed background refetch even though `rows` still
  // holds good data, and would wrongly disable Save.
  const ready = Boolean(shift) && loadedShiftId.current === shift?.id;
  const dirty = ready && JSON.stringify(rows) !== JSON.stringify(loadedRows.current);
  useWarnUnsavedChanges(dirty);

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
        sequence: current.length + 1,
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
      current.filter((_, i) => i !== index).map((row, i) => ({ ...row, sequence: i + 1 })),
    );
  }

  function handleSave() {
    if (!ready) return;
    const saved = rows;
    replaceSlots.mutate(rows, {
      onSuccess: () => {
        loadedRows.current = saved;
        toast.success(t('save.success'));
      },
      onError: (error) =>
        toast.error(
          t(
            error instanceof ApiError && error.statusCode === 409
              ? 'periodSlotsPanel.inUseError'
              : error instanceof ApiError && error.statusCode === 400
                ? 'periodSlotsPanel.invalidError'
                : 'periodSlotsPanel.saveError',
          ),
        ),
    });
  }

  const dayStart = shift ? timeToMinutes(shift.day_starts_at) : 0;
  const dayEnd = shift ? timeToMinutes(shift.day_ends_at) : 0;
  const dayMinutes = Math.max(dayEnd - dayStart, 1);

  const rowErrors: (RowError | null)[] = rows.map((row, index) => {
    const start = timeToMinutes(row.starts_at);
    const end = timeToMinutes(row.ends_at);
    if (end <= start) return 'endBeforeStart';
    if (shift && (start < dayStart || end > dayEnd)) return 'outsideShift';
    const previous = rows[index - 1];
    if (previous && start < timeToMinutes(previous.ends_at)) return 'overlapsPrevious';
    return null;
  });
  const hasErrors = rowErrors.some(Boolean);

  const errorText = (error: RowError) =>
    t(`periodSlotsPanel.errors.${error}`, {
      start: shift ? formatTime(shift.day_starts_at, config) : '',
      end: shift ? formatTime(shift.day_ends_at, config) : '',
    });
  const n = (index: number) => formatNumber(index + 1, config);
  const inRow = (field: string, index: number) =>
    t('periodSlotsPanel.fieldInRow', { field, n: n(index) });
  const kindLabel = (kind: PeriodSlotKind) =>
    t(kind === 'BREAK' ? 'periodSlotsPanel.kindBreak' : 'periodSlotsPanel.kindClass');

  const minTime = shift?.day_starts_at.slice(0, 5);
  const maxTime = shift?.day_ends_at.slice(0, 5);

  function kindSelect(index: number, row: PeriodSlotItem, idPrefix: string) {
    return (
      <Select
        value={row.kind}
        onValueChange={(value) => updateRow(index, { kind: value as PeriodSlotKind })}
      >
        <SelectTrigger
          id={`${idPrefix}-kind-${index}`}
          className="w-full"
          aria-label={inRow(t('periodSlotsPanel.kind'), index)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CLASS">{kindLabel('CLASS')}</SelectItem>
          <SelectItem value="BREAK">{kindLabel('BREAK')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  function nameInput(index: number, row: PeriodSlotItem, idPrefix: string) {
    return (
      <Input
        id={`${idPrefix}-name-${index}`}
        aria-label={inRow(t('periodSlotsPanel.name'), index)}
        placeholder={t('periodSlotsPanel.namePlaceholder')}
        value={row.name ?? ''}
        onChange={(event) => updateRow(index, { name: event.target.value || null })}
      />
    );
  }

  function timeField(
    index: number,
    row: PeriodSlotItem,
    key: 'starts_at' | 'ends_at',
    idPrefix: string,
  ) {
    const label = t(key === 'starts_at' ? 'periodSlotsPanel.startsAt' : 'periodSlotsPanel.endsAt');
    return (
      <TimeInput
        id={`${idPrefix}-${key}-${index}`}
        aria-label={inRow(label, index)}
        value={row[key]}
        onValueChange={(value) => updateRow(index, { [key]: value })}
        stepMinutes={5}
        {...(minTime ? { min: minTime } : {})}
        {...(maxTime ? { max: maxTime } : {})}
      />
    );
  }

  const lessonCount = rows.filter((row) => row.kind === 'CLASS').length;
  const breakCount = rows.length - lessonCount;

  const phoneHeadings = rows.map((row) =>
    row.kind === 'BREAK'
      ? kindLabel('BREAK')
      : t('agenda.periodLabel', { sequence: formatNumber(row.sequence, config) }),
  );

  return (
    <Card padded={false} className="overflow-hidden">
      <section aria-label={t('periodSlotsPanel.legend')}>
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between md:p-5">
          <div>
            <h2 className="text-h2">{t('periodSlotsPanel.legend')}</h2>
            <p className="mt-1 text-text-secondary">{t('periodSlotsPanel.subtitle')}</p>
          </div>
          <div className="flex flex-col gap-1 md:w-64">
            <Label htmlFor="period-slots-shift">{t('periodSlotsPanel.shiftLabel')}</Label>
            <Select value={shift?.id ?? ''} onValueChange={onSelectShift}>
              <SelectTrigger id="period-slots-shift" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shifts.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!shift ? (
          <div className="p-4 pt-0 md:p-5 md:pt-0">
            <EmptyState
              icon={<ClockIcon aria-hidden="true" />}
              title={t('periodSlotsPanel.noShiftTitle')}
              explanation={t('periodSlotsPanel.selectShift')}
            />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full">
                <caption className="sr-only">
                  {t('periodSlotsPanel.caption', { shiftName: shift.name })}
                </caption>
                <thead className="border-y border-border-subtle bg-muted text-label text-text-secondary">
                  <tr className="text-start">
                    <th className="w-16 px-2 py-2 text-start font-medium">
                      {t('periodSlotsPanel.sequence')}
                    </th>
                    <th className="w-40 px-2 py-2 text-start font-medium">
                      {t('periodSlotsPanel.kind')}
                    </th>
                    <th className="px-2 py-2 text-start font-medium">
                      {t('periodSlotsPanel.name')}
                    </th>
                    <th className="w-44 px-2 py-2 text-start font-medium">
                      {t('periodSlotsPanel.startsAt')}
                    </th>
                    <th className="w-44 px-2 py-2 text-start font-medium">
                      {t('periodSlotsPanel.endsAt')}
                    </th>
                    <th className="w-20 px-2 py-2 text-end">
                      <span className="sr-only">{t('delete.action')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const error = rowErrors[index];
                    return (
                      <React.Fragment key={index}>
                        <tr className={row.kind === 'BREAK' ? 'bg-muted' : undefined}>
                          <td className="h-12 px-2 py-1">{n(index)}</td>
                          <td className="h-12 px-2 py-1">{kindSelect(index, row, 'd')}</td>
                          <td className="h-12 px-2 py-1">{nameInput(index, row, 'd')}</td>
                          <td className="h-12 px-2 py-1">
                            {timeField(index, row, 'starts_at', 'd')}
                          </td>
                          <td className="h-12 px-2 py-1">
                            {timeField(index, row, 'ends_at', 'd')}
                          </td>
                          <td className="h-12 px-2 py-1 text-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={t('periodSlotsPanel.removeRow', { n: n(index) })}
                              onClick={() => removeRow(index)}
                            >
                              <CircleMinusIcon aria-hidden="true" />
                            </Button>
                          </td>
                        </tr>
                        {error && (
                          <tr className={row.kind === 'BREAK' ? 'bg-muted' : undefined}>
                            <td colSpan={6} className="px-4 pb-2">
                              <p className="flex items-center gap-1 text-caption text-destructive">
                                <CircleAlertIcon className="size-4" aria-hidden="true" />
                                {errorText(error)}
                              </p>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border-subtle border-t border-border-subtle md:hidden">
              {rows.map((row, index) => {
                const error = rowErrors[index];
                return (
                  <li
                    key={index}
                    className={`space-y-3 p-4 ${row.kind === 'BREAK' ? 'bg-muted' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium">
                        {t('periodSlotsPanel.rowHeading', {
                          what: phoneHeadings[index],
                          n: n(index),
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="-me-2 text-destructive"
                        aria-label={t('periodSlotsPanel.removeRow', { n: n(index) })}
                        onClick={() => removeRow(index)}
                      >
                        <CircleMinusIcon aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`m-starts_at-${index}`}>
                          {t('periodSlotsPanel.startsAt')}
                        </Label>
                        {timeField(index, row, 'starts_at', 'm')}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`m-ends_at-${index}`}>{t('periodSlotsPanel.endsAt')}</Label>
                        {timeField(index, row, 'ends_at', 'm')}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`m-kind-${index}`}>{t('periodSlotsPanel.kind')}</Label>
                        {kindSelect(index, row, 'm')}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`m-name-${index}`}>{t('periodSlotsPanel.name')}</Label>
                        {nameInput(index, row, 'm')}
                      </div>
                    </div>
                    {error && (
                      <p className="flex items-center gap-1 text-caption text-destructive">
                        <CircleAlertIcon className="size-4" aria-hidden="true" />
                        {errorText(error)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {rows.length === 0 && (
              <p className="px-4 py-3 text-text-secondary md:px-5">
                {t('periodSlotsPanel.noRows')}
              </p>
            )}

            {/* Timeline strip: one block per slot, positioned/sized by its
                share of the shift's day window — a gap between two blocks is
                a missing period, visible at a glance while still typing. */}
            <div className="space-y-2 border-t border-border-subtle p-4 md:px-5">
              <p className="text-label">{t('periodSlotsPanel.timelineLabel')}</p>
              <div
                role="img"
                aria-label={t('periodSlotsPanel.timelineAria', {
                  start: formatTime(shift.day_starts_at, config),
                  end: formatTime(shift.day_ends_at, config),
                  lessons: formatNumber(lessonCount, config),
                  breaks: formatNumber(breakCount, config),
                })}
                className="relative flex h-6 w-full gap-px overflow-hidden rounded-md border border-border-subtle bg-muted"
              >
                {rows.map((row, index) => {
                  const start = timeToMinutes(row.starts_at);
                  const end = timeToMinutes(row.ends_at);
                  const widthPercent = (Math.max(end - start, 0) / dayMinutes) * 100;
                  const offsetPercent = (Math.max(start - dayStart, 0) / dayMinutes) * 100;
                  return (
                    <div
                      key={index}
                      title={`${formatTime(row.starts_at, config)} – ${formatTime(row.ends_at, config)}`}
                      className={
                        row.kind === 'BREAK'
                          ? 'absolute h-6 bg-text-secondary opacity-40'
                          : 'absolute h-6 bg-primary opacity-60'
                      }
                      style={{ insetInlineStart: `${offsetPercent}%`, width: `${widthPercent}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-caption text-text-secondary">
                <span>{formatTime(shift.day_starts_at, config)}</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2 rounded-full bg-primary opacity-60"
                      aria-hidden="true"
                    />
                    {kindLabel('CLASS')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2 rounded-full bg-text-secondary opacity-40"
                      aria-hidden="true"
                    />
                    {kindLabel('BREAK')}
                  </span>
                </span>
                <span>{formatTime(shift.day_ends_at, config)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5">
              <p className="hidden text-caption text-text-secondary md:block">
                {t('periodSlotsPanel.changeoverHint', {
                  minutes: formatNumber(changeoverGapMinutes, config),
                })}
              </p>
              <div className="flex flex-col-reverse gap-2 md:flex-row">
                <Button type="button" variant="outline" onClick={() => appendRow(rows.length - 1)}>
                  <PlusIcon aria-hidden="true" />
                  {t('periodSlotsPanel.addRowAction')}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!ready || hasErrors}
                  loading={replaceSlots.isPending}
                >
                  {t('save.action')}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </Card>
  );
}
