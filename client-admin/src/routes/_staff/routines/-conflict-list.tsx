/**
 * [21.8.1] D8/D9 — every hard violation from the server's 409 (`Constraint
 * Violation[]`, see `ui/src/hooks/routines.ts`'s `conflictViolations`)
 * renders here in plain wording, all of them, and their presence is what
 * `$sectionId.tsx` reads to decide "keep the save blocked". Warnings are
 * a wholly separate, non-blocking list rendered with a different tone —
 * they come back on a *successful* save (`RoutineSlotWithWarnings.
 * warnings`), never through this same array.
 *
 * [31.4] Text comes from `conflictList.codes.<code>`, never the server's
 * English `message` (D9); one sentence per code.
 */
import type { ConstraintViolation, ConstraintWarning } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { TriangleAlertIcon } from 'lucide-react';

export interface ConflictListProps {
  violations: ConstraintViolation[];
  warnings?: ConstraintWarning[];
}

export function ConflictList({ violations, warnings = [] }: ConflictListProps) {
  const { t } = useTranslation('routines');

  if (violations.length === 0 && warnings.length === 0) return null;

  const sentences = (items: { code: string }[]) =>
    [...new Set(items.map((item) => item.code))].map((code) => (
      <li key={code}>
        {t(`conflictList.codes.${code}`, { defaultValue: t('conflictList.codes.unknown') })}
      </li>
    ));

  return (
    <div className="flex flex-col gap-2">
      {violations.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-status-overdue-fg bg-status-overdue-bg p-4 text-status-overdue-fg"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4" aria-hidden="true" />
            {t('conflictList.violationsTitle')}
          </p>
          <ul className="mt-1 list-disc ps-5">{sentences(violations)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-status-due-fg bg-status-due-bg p-4 text-status-due-fg">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4" aria-hidden="true" />
            {t('conflictList.warningsTitle')}
          </p>
          <ul className="mt-1 list-disc ps-5">{sentences(warnings)}</ul>
        </div>
      )}
    </div>
  );
}
