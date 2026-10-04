/**
 * D7, D25: time-of-day picker ("08:00") on a stepped list. Stub — filled in by
 * 31.2.2 (clock icon, list styling).
 */
import { useRegionConfig, useTranslation } from '../i18n';
import { formatTime } from '../utils/date';

import { Combobox, type ComboboxOption } from './combobox';

export interface TimeInputProps {
  /** `"08:00"`. */
  value: string | undefined;
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
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    options.push({ value: hhmm, label: formatTime(hhmm, regionConfig) });
  }
  return (
    <Combobox
      {...props}
      options={options}
      value={value ?? null}
      onValueChange={(v) => v && onValueChange(v)}
      placeholder={placeholder ?? t('date.pickTime')}
      announceResults={(n) => t('combobox.results', { count: n })}
      emptyText={t('table.empty')}
    />
  );
}
