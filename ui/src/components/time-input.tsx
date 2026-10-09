/** D7, D25: time-of-day picker ("08:00") on a stepped list; thin wrapper over Combobox. */
import { ClockIcon } from 'lucide-react';

import { useRegionConfig, useTranslation } from '../i18n';
import { formatTime } from '../utils/date';

import { Combobox, type ComboboxOption } from './combobox';

export interface TimeInputProps {
  /** `"08:00"`; an API `"08:00:00"` is read as `"08:00"`. */
  value: string | undefined;
  /** Always `HH:mm`. */
  onValueChange: (value: string) => void;
  /** Default 30. */
  stepMinutes?: number;
  /** Default `t('date.pickTime')`. */
  placeholder?: string;
  /** `"HH:mm"`, inclusive, default `"00:00"`. */
  min?: string;
  /** Default `"23:59"`. */
  max?: string;
  'aria-label': string;
  id?: string;
  disabled?: boolean;
}

function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

const toHhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function TimeInput({
  value,
  onValueChange,
  stepMinutes = 30,
  placeholder,
  min = '00:00',
  max = '23:59',
  ...props
}: TimeInputProps) {
  const { t } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const options: ComboboxOption[] = [];
  for (let m = toMinutes(min); m <= toMinutes(max); m += Math.max(1, stepMinutes)) {
    const hhmm = toHhmm(m);
    options.push({ value: hhmm, label: formatTime(hhmm, regionConfig) });
  }
  // Seconds dropped so a Postgres `time` ("08:00:00") matches the "08:00" option.
  const current = value ? toHhmm(toMinutes(value)) : undefined;
  // Data saved off the step grid (08:10) must still show.
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: formatTime(current, regionConfig) });
    options.sort((a, b) => toMinutes(a.value) - toMinutes(b.value));
  }
  return (
    <div className="relative">
      <Combobox
        {...props}
        className="pe-9"
        options={options}
        value={current ?? null}
        onValueChange={(v) => v && onValueChange(v)}
        placeholder={placeholder ?? t('date.pickTime')}
        announceResults={(n) => t('combobox.results', { count: n })}
        emptyText={t('table.empty')}
      />
      <ClockIcon
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
        aria-hidden="true"
      />
    </div>
  );
}
