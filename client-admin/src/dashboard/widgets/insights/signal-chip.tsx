/**
 * [169.3-1874] One at-risk signal as icon + text (never colour alone, never
 * the raw enum, P4). The look is the BriefingChip's, minus its list item.
 */
import type { components } from '@biddaloy/ui/api';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CalendarIcon, CalendarXIcon, FileXIcon, WalletIcon } from 'lucide-react';

type Signal = components['schemas']['AtRiskSignalDto'];

const ICON = {
  ABSENT_STREAK: CalendarXIcon,
  LOW_ATTENDANCE: CalendarIcon,
  FAILED_SUBJECTS: FileXIcon,
  OVERDUE: WalletIcon,
} as const;

export function SignalChip({ signal }: { signal: Signal }) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const n = formatNumber(signal.value, region);
  const key = 'widgets.at-risk-students.';

  let text: string;
  switch (signal.kind) {
    case 'ABSENT_STREAK':
      text = t(`${key}signalAbsentStreak`, { days: n });
      break;
    case 'LOW_ATTENDANCE':
      text = t(`${key}signalLowAttendance`, { percent: `${n}%` });
      break;
    case 'FAILED_SUBJECTS':
      text = t(`${key}signalFailed`, {
        subjects: (signal.subjects ?? [])
          .map((s) => (locale === 'bn' ? (s.name_bn ?? s.name_en) : s.name_en))
          .join(', '),
      });
      break;
    case 'OVERDUE':
      text = t(`${key}signalOverdue`, { days: n });
      break;
    default:
      return null;
  }
  const Icon = ICON[signal.kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 text-caption">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
