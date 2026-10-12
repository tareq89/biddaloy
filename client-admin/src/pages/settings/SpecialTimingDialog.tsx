/**
 * [68.5.01] Add / edit one special timing (Ramadan, winter): a dated range with
 * its own late cut-offs and, for a single shift, its own period times.
 *
 * Plain local state, not RHF: this dialog renders inside the Attendance
 * `<form>`'s React tree, so a nested `<form>`/submit would bubble into the
 * section's save. Checks mirror the server's `SpecialTimingsValid`
 * (tenant-settings.dto.ts): from <= to, startsAt < endsAt, no same-shift overlap.
 */
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimeInput,
} from '@biddaloy/ui/components';
import { usePeriodSlots, type AttendancePolicySettings, type Shift } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export type SpecialTiming = NonNullable<AttendancePolicySettings['specialTimings']>[number];

const ALL_SHIFTS = '__all__';

interface SpecialTimingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: SpecialTiming | undefined;
  shifts: Pick<Shift, 'id' | 'name'>[];
  /** Shift ids that have their own `shiftTimes` row (an all-shifts entry skips them). */
  shiftsWithOwnTimes: string[];
  /** The other saved entries, for the same-shift overlap check. */
  others: SpecialTiming[];
  schoolLateAfter: string;
  schoolAbsentAfter: string;
  onSave: (timing: SpecialTiming) => void;
}

type PeriodEdits = Record<number, { startsAt: string; endsAt: string }>;

export function SpecialTimingDialog(props: SpecialTimingDialogProps) {
  // Remount per open so the draft always starts from `initial`.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>{props.open && <DialogBody {...props} />}</DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
  initial,
  shifts,
  shiftsWithOwnTimes,
  others,
  schoolLateAfter,
  schoolAbsentAfter,
  onSave,
}: SpecialTimingDialogProps) {
  const { t } = useTranslation('settings');
  const config = useRegionConfig();
  const [name, setName] = React.useState(initial?.name ?? '');
  const [from, setFrom] = React.useState<Date | undefined>(
    initial ? parseDate(initial.from) : undefined,
  );
  const [to, setTo] = React.useState<Date | undefined>(initial ? parseDate(initial.to) : undefined);
  const [shiftId, setShiftId] = React.useState<string | null>(initial?.shiftId ?? null);
  const [lateAfter, setLateAfter] = React.useState(initial?.lateAfter ?? schoolLateAfter);
  const [absentAfter, setAbsentAfter] = React.useState(initial?.absentAfter ?? schoolAbsentAfter);
  const [edits, setEdits] = React.useState<PeriodEdits>(() =>
    Object.fromEntries((initial?.periods ?? []).map((p) => [p.sequence, p])),
  );
  const [submitted, setSubmitted] = React.useState(false);

  const slots = usePeriodSlots(shiftId ?? undefined).data;
  const rows = shiftId ? (slots ?? []) : [];

  const fromIso = from ? toIsoDate(from) : '';
  const toIso = to ? toIsoDate(to) : '';
  const badRange = Boolean(from && to && fromIso > toIso);
  const badPeriod = (seq: number) => {
    const e = edits[seq];
    return Boolean(e && e.startsAt >= e.endsAt);
  };
  const overlaps =
    Boolean(from && to) &&
    others.some((o) => o.shiftId === shiftId && o.from <= toIso && fromIso <= o.to);
  const anyBadPeriod = rows.some((r) => badPeriod(r.sequence));
  const valid =
    name.trim() !== '' && Boolean(from && to) && !badRange && !overlaps && !anyBadPeriod;

  function save() {
    setSubmitted(true);
    if (!valid) return;
    onSave({
      name: name.trim(),
      from: fromIso,
      to: toIso,
      shiftId,
      lateAfter,
      absentAfter,
      // Only rows the admin changed; none without a single shift.
      periods: rows.flatMap((r) => {
        const e = edits[r.sequence];
        return e && (e.startsAt !== r.starts_at || e.endsAt !== r.ends_at)
          ? [{ sequence: r.sequence, startsAt: e.startsAt, endsAt: e.endsAt }]
          : [];
      }),
    });
    onOpenChange(false);
  }

  const err = (msg: string) => (
    <p role="alert" className="text-caption text-destructive">
      {msg}
    </p>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(
            initial ? 'attendance.specialTimings.editTitle' : 'attendance.specialTimings.addTitle',
          )}
        </DialogTitle>
        <DialogDescription>{t('attendance.specialTimings.help')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="special-timing-name">{t('attendance.specialTimings.name')}</Label>
          <Input
            id="special-timing-name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {submitted && name.trim() === '' && err(t('attendance.specialTimings.nameRequired'))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>{t('attendance.specialTimings.from')}</Label>
            <DatePicker
              config={config}
              value={from}
              onValueChange={setFrom}
              aria-label={t('attendance.specialTimings.from')}
            />
            {submitted && !from && err(t('attendance.specialTimings.dateRequired'))}
          </div>
          <div className="grid gap-1.5">
            <Label>{t('attendance.specialTimings.to')}</Label>
            <DatePicker
              config={config}
              value={to}
              onValueChange={setTo}
              aria-label={t('attendance.specialTimings.to')}
            />
            {submitted && !to && err(t('attendance.specialTimings.dateRequired'))}
          </div>
        </div>
        {badRange && err(t('attendance.specialTimings.rangeInvalid'))}
        <div className="grid gap-1.5">
          <Label htmlFor="special-timing-shift">{t('attendance.specialTimings.shift')}</Label>
          <Select
            value={shiftId ?? ALL_SHIFTS}
            onValueChange={(v) => {
              setShiftId(v === ALL_SHIFTS ? null : v);
              setEdits({});
            }}
          >
            <SelectTrigger id="special-timing-shift">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SHIFTS}>{t('attendance.specialTimings.allShifts')}</SelectItem>
              {shifts.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shiftId === null && shiftsWithOwnTimes.length > 0 && (
            <p className="text-caption text-text-secondary">
              {t('attendance.specialTimings.ownTimesNote')}
            </p>
          )}
          {overlaps && err(t('attendance.specialTimings.overlap'))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="special-timing-late">{t('attendance.lateAfter')}</Label>
            <TimeInput
              id="special-timing-late"
              aria-label={t('attendance.lateAfter')}
              value={lateAfter}
              onValueChange={setLateAfter}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="special-timing-absent">{t('attendance.absentAfter')}</Label>
            <TimeInput
              id="special-timing-absent"
              aria-label={t('attendance.absentAfter')}
              value={absentAfter}
              onValueChange={setAbsentAfter}
            />
          </div>
        </div>
        {rows.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="text-label text-text-primary">
              {t('attendance.specialTimings.periodsLegend')}
            </legend>
            {rows.map((slot) => {
              const e = edits[slot.sequence] ?? { startsAt: slot.starts_at, endsAt: slot.ends_at };
              const label = slot.name ?? String(slot.sequence);
              return (
                <div key={slot.id} role="group" aria-label={label} className="grid gap-1">
                  <div className="grid grid-cols-[4rem_1fr_1fr] items-center gap-2">
                    <span className="text-label">{label}</span>
                    <TimeInput
                      aria-label={`${label} — ${t('attendance.specialTimings.periodStart')}`}
                      value={e.startsAt}
                      onValueChange={(v) =>
                        setEdits({ ...edits, [slot.sequence]: { ...e, startsAt: v } })
                      }
                    />
                    <TimeInput
                      aria-label={`${label} — ${t('attendance.specialTimings.periodEnd')}`}
                      value={e.endsAt}
                      onValueChange={(v) =>
                        setEdits({ ...edits, [slot.sequence]: { ...e, endsAt: v } })
                      }
                    />
                  </div>
                  {badPeriod(slot.sequence) && err(t('attendance.specialTimings.periodInvalid'))}
                </div>
              );
            })}
          </fieldset>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {t('attendance.specialTimings.cancel')}
        </Button>
        <Button type="button" onClick={save}>
          {t('attendance.specialTimings.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
