/**
 * [52.5.1] The one-line "বিষয়" text per application type. Long free text is returned whole —
 * the cell truncates it with CSS, never here.
 */
import { ApplicationType } from '@biddaloy/shared';
import type { ApplicationListItemDto } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatServerAmount,
  parseDate,
} from '@biddaloy/ui/utils';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Calendar days, both ends included. */
function daysBetween(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
}

export function summarize(
  app: Pick<ApplicationListItemDto, 'type' | 'payload' | 'start_date' | 'end_date' | 'ref_names'>,
  t: Translate,
  config: RegionConfig,
): string {
  const p = app.payload;
  switch (app.type as ApplicationType) {
    case ApplicationType.STAFF_LEAVE:
    case ApplicationType.STUDENT_LEAVE: {
      if (!app.start_date || !app.end_date) return str(p.reason);
      const count = daysBetween(app.start_date, app.end_date);
      return `${formatDateRange(app.start_date, app.end_date, config)} · ${t('days', { ns: 'applicationsList', count, n: formatNumber(count, config) })}`;
    }
    case ApplicationType.FEE_WAIVER: {
      const fees = Array.isArray(p.fee_types)
        ? (p.fee_types as string[]).map((f) => t(`feeTypes.${f}`, { ns: 'feeStructures' }))
        : [];
      const value =
        p.kind === 'PERCENT'
          ? `${formatNumber(Number(p.value), config)}%`
          : formatServerAmount(p.value as number | string, config);
      return [...fees, value].join(' · ');
    }
    case ApplicationType.TESTIMONIAL:
      return str(p.purpose);
    case ApplicationType.GENERAL:
      return str(p.subject_line);
    case ApplicationType.TRANSFER_CERTIFICATE:
      return typeof p.leaving_date === 'string' ? formatDate(p.leaving_date, config) : '';
    case ApplicationType.SECTION_CHANGE:
      return app.ref_names.to_section_id ?? '';
    case ApplicationType.READMISSION:
      return app.ref_names.class_section_id ?? '';
    default:
      return str(p.reason);
  }
}
