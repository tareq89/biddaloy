import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { countSmsSegments, formatNumber } from '@biddaloy/ui/utils';

/**
 * "X characters · Y SMS" under a message composer —
 * [8.11.9]'s "Bangla text … including character-count limits for SMS"
 * AC. `aria-live="polite"` so a screen-reader user typing hears the
 * count move without leaving the textarea; pass `live={false}` for
 * static renders (a preview table row) where nothing is being typed and
 * a chorus of live regions would only add noise. `countSmsSegments`
 * decides GSM-7 vs UCS-2, which is what makes the figure honest for
 * Bangla (70/67 per segment) rather than quoting the Latin 160.
 * `chars` goes through the tenant numeral formatter; `count` only picks
 * the plural form.
 */
export function SmsSegmentCounter({ text, live = true }: { text: string; live?: boolean }) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const info = countSmsSegments(text);
  return (
    <p
      {...(live ? { 'aria-live': 'polite' as const } : {})}
      className="text-caption text-text-secondary"
    >
      {t('smsCounter.count', {
        chars: formatNumber(info.chars, config),
        count: info.segments,
        n: formatNumber(info.segments, config),
      })}
    </p>
  );
}
