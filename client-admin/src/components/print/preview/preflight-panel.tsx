/**
 * [32.3.4] Pre-flight (D14): which cards in this batch have a problem — text that
 * overflows its box, a missing photo, an empty name. Nothing is blocked outright;
 * with any issue the person must tick "Print anyway" before Print unlocks.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PreflightIssue {
  subjectId: string;
  label: string;
  /** Already translated, one per problem. */
  reasons: string[];
}

export interface PreflightPanelProps {
  issues: PreflightIssue[];
  /** Cards in the current batch. */
  total: number;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}

export function PreflightPanel({
  issues,
  total,
  acknowledged,
  onAcknowledgedChange,
}: PreflightPanelProps) {
  const { t } = useTranslation('printPreview');
  if (issues.length === 0) return null;

  return (
    <section
      aria-label={t('preflight.title', { bad: issues.length, total })}
      className="flex flex-col gap-2 rounded-lg border border-status-due-fg/40 bg-status-due-bg p-4 text-sm text-status-due-fg"
    >
      <h2 className="font-semibold">{t('preflight.title', { bad: issues.length, total })}</h2>
      <ul className="list-disc ps-5">
        {issues.map((issue) => (
          <li key={issue.subjectId}>
            <span className="font-medium">{issue.label}</span>: {issue.reasons.join(' · ')}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
        />
        {t('preflight.printAnyway')}
      </label>
    </section>
  );
}
