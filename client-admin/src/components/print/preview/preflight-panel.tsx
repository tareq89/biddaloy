/**
 * [32.3.4] Pre-flight (D14): which cards in this batch have a problem — text that
 * overflows its box, a missing photo, an empty name. Nothing is blocked outright;
 * with any issue the person must tick "Print anyway" before Print unlocks.
 */
import { Checkbox } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { TriangleAlertIcon } from 'lucide-react';

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
      className="rounded-lg border border-border-subtle bg-status-due-bg p-4 text-status-due-fg md:p-5"
    >
      <h2 className="flex items-center gap-2 text-h3">
        <TriangleAlertIcon className="size-5" aria-hidden />
        {t('preflight.title', { bad: issues.length, total })}
      </h2>
      <ul className="mt-2 list-disc space-y-1 ps-5">
        {issues.map((issue) => (
          <li key={issue.subjectId}>
            <span className="font-medium">{issue.label}</span>: {issue.reasons.join(' · ')}
          </li>
        ))}
      </ul>
      <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 font-medium md:min-h-8">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(next) => onAcknowledgedChange(next === true)}
        />
        {t('preflight.printAnyway')}
      </label>
    </section>
  );
}
