/**
 * [16.3.6] D6/D13's duplicate-handling step, shown inline in the same
 * full-page form (not a wizard page) once `useGenerateFeesPreview` reports
 * duplicates or inactive students in scope. One global choice, not a
 * per-row one — D13 treats the whole batch's duplicates the same way,
 * since asking the accountant to decide row-by-row for a batch of
 * hundreds would defeat the point of a batch tool.
 *
 * `CREATE_ANYWAY` is called out as needing approval because it's the one
 * option that writes a second fee record for a student who may already
 * have paid the first — `fees.duplicate_override`'s step-up gate
 * (`useApprovedMutation`) exists specifically to put a second person in
 * the loop for that case.
 */
import { RadioGroup, RadioGroupItem } from '@biddaloy/ui/components';
import type { GenerateFeesPreviewResult } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ClockIcon } from 'lucide-react';

export interface DuplicatesStepProps {
  preview: GenerateFeesPreviewResult;
  action: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY';
  onActionChange: (action: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY') => void;
  /** id -> display name for the students the accountant selected — the
   * server's `DuplicateBillDto` only carries `student_id`/`fee_structure_id`
   * (see `ui/src/hooks/fee-generation.ts`'s own comment), so a
   * human-readable row has to resolve those ids against selections this
   * form already made, not against the preview response itself. */
  studentNames: Map<string, string>;
  /** id -> display name for the fee structures the accountant selected. */
  feeStructureNames: Map<string, string>;
}

export function DuplicatesStep({
  preview,
  action,
  onActionChange,
  studentNames,
  feeStructureNames,
}: DuplicatesStepProps) {
  const { t } = useTranslation('feeGeneration');
  const regionConfig = useRegionConfig();
  return (
    <div className="mt-4">
      <div role="status" className="rounded-md bg-status-due-bg p-4 text-status-due-fg">
        <p className="flex items-center gap-2 font-medium">
          <ClockIcon className="size-4" aria-hidden="true" />
          {t('duplicates.heading')}
        </p>
        {preview.duplicates.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {preview.duplicates.map((duplicate) => {
              const student =
                studentNames.get(duplicate.student_id) ?? t('audience.unknownStudentName');
              const fee =
                feeStructureNames.get(duplicate.fee_structure_id) ?? t('duplicates.unknownFee');
              return (
                <li key={`${duplicate.student_id}-${duplicate.fee_structure_id}`}>
                  {t('duplicates.row', { student, fee })}
                </li>
              );
            })}
          </ul>
        )}
        {preview.inactive.length > 0 && (
          <p className="mt-2">
            {t('duplicates.inactiveCount', {
              count: preview.inactive.length,
              n: formatNumber(preview.inactive.length, regionConfig),
            })}
          </p>
        )}
      </div>

      <RadioGroup
        value={action}
        onValueChange={(value) => onActionChange(value as typeof action)}
        aria-label={t('duplicates.decisionLabel')}
        className="mt-3"
      >
        <label className="flex min-h-11 items-start gap-3 py-2">
          <RadioGroupItem value="SKIP" className="mt-0.5" />
          <span>
            <span className="block font-medium">{t('duplicates.skipLabel')}</span>{' '}
            <span className="block text-caption text-text-secondary">
              {t('duplicates.skipHint')}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 py-2">
          <RadioGroupItem value="REMOVE_OLDER" className="mt-0.5" />
          <span>
            <span className="block font-medium">{t('duplicates.removeOlderLabel')}</span>{' '}
            <span className="block text-caption text-text-secondary">
              {t('duplicates.removeOlderHint')}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 py-2">
          <RadioGroupItem value="CREATE_ANYWAY" className="mt-0.5" />
          <span>
            <span className="block font-medium">{t('duplicates.createAnywayLabel')}</span>{' '}
            <span className="block text-caption text-text-secondary">
              {t('duplicates.createAnywayHint')}
            </span>
          </span>
        </label>
      </RadioGroup>
    </div>
  );
}
