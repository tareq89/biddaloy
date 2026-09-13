/**
 * [16.3.6] D6/D13's duplicate-handling step, shown inline in the same
 * dialog (not a wizard page) once `useGenerateFeesPreview` reports
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
import { useTranslation } from '@biddaloy/ui/i18n';

export interface DuplicatesStepProps {
  preview: GenerateFeesPreviewResult;
  action: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY';
  onActionChange: (action: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY') => void;
}

export function DuplicatesStep({ preview, action, onActionChange }: DuplicatesStepProps) {
  const { t } = useTranslation('feeGeneration');

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
      <h3 className="text-sm font-medium">{t('duplicates.heading')}</h3>

      {preview.duplicates.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {preview.duplicates.map((duplicate) => (
            <li key={`${duplicate.student_id}-${duplicate.fee_structure_id}`}>
              {t('duplicates.row', {
                student: duplicate.student_name,
                fee: duplicate.fee_structure_name,
              })}
            </li>
          ))}
        </ul>
      )}

      {preview.inactive_students.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('duplicates.inactiveCount', { count: preview.inactive_students.length })}
        </p>
      )}

      <RadioGroup
        value={action}
        onValueChange={(value) => onActionChange(value as typeof action)}
        aria-label={t('duplicates.heading')}
        className="flex flex-col gap-2"
      >
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="SKIP" />
          <span>
            <span className="font-medium">{t('duplicates.skipLabel')}</span>{' '}
            <span className="text-muted-foreground">{t('duplicates.skipHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="REMOVE_OLDER" />
          <span>
            <span className="font-medium">{t('duplicates.removeOlderLabel')}</span>{' '}
            <span className="text-muted-foreground">{t('duplicates.removeOlderHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="CREATE_ANYWAY" />
          <span>
            <span className="font-medium">{t('duplicates.createAnywayLabel')}</span>{' '}
            <span className="text-muted-foreground">{t('duplicates.createAnywayHint')}</span>
          </span>
        </label>
      </RadioGroup>
    </div>
  );
}
