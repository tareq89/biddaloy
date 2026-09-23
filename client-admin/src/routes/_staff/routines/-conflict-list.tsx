/**
 * [21.8.1] D8/D9 — every hard violation from the server's 409 (`Constraint
 * Violation[]`, see `ui/src/hooks/routines.ts`'s `conflictViolations`)
 * renders here in plain wording, all of them, and their presence is what
 * `$sectionId.tsx` reads to decide "keep the save blocked". Warnings are
 * a wholly separate, non-blocking list rendered with a different tone —
 * they come back on a *successful* save (`RoutineSlotWithWarnings.
 * warnings`), never through this same array.
 */
import type { ConstraintViolation, ConstraintWarning } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface ConflictListProps {
  violations: ConstraintViolation[];
  warnings?: ConstraintWarning[];
}

export function ConflictList({ violations, warnings = [] }: ConflictListProps) {
  const { t } = useTranslation('routines');

  if (violations.length === 0 && warnings.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {violations.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-status-overdue-fg bg-status-overdue-bg p-3 text-sm text-status-overdue-fg"
        >
          <p className="font-medium">{t('conflictList.violationsTitle')}</p>
          <ul className="mt-1 list-disc pl-5">
            {violations.map((violation, index) => (
              <li key={`${violation.code}-${index}`}>{violation.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border border-status-due-fg bg-status-due-bg p-3 text-sm text-status-due-fg">
          <p className="font-medium">{t('conflictList.warningsTitle')}</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
