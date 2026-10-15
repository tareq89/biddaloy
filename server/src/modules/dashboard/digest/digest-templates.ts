import type { AttentionSummaryDto } from '../../attention/api/dto/alert-item.dto';
import { toBanglaDigits, type AttentionLocale } from '../../attention/rules/messages';

/**
 * Morning digest text (D31). Count of the user's own open items plus the title of the most urgent
 * one. A title that names a student is left out: a push on a lock screen never shows a name.
 */
export function renderDigest(
  summary: Pick<AttentionSummaryDto, 'critical' | 'warning' | 'reminder' | 'top'>,
  locale: AttentionLocale,
  schoolName: string,
): { title: string; body: string } | null {
  const count = summary.critical + summary.warning + summary.reminder;
  if (count === 0) return null;
  const headline =
    locale === 'bn'
      ? `আজ ${toBanglaDigits(String(count))}টা বিষয় আপনার নজর চাইছে।`
      : `${count} ${count === 1 ? 'thing needs' : 'things need'} you today.`;
  const top = summary.top && !summary.top.studentName ? summary.top.title : null;
  const urgent = top ? ` ${locale === 'bn' ? 'সবচেয়ে জরুরি' : 'Most urgent'}: ${top}` : '';
  return { title: schoolName, body: headline + urgent };
}
