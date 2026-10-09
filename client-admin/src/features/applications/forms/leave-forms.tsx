import { LeaveType, StudentLeaveReason } from '@biddaloy/shared';
import { useLeaveBalance } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useWatch } from 'react-hook-form';

import { DateField, SelectField, TextField } from './fields';
import type { ApplicationSubject } from './registry';

export function StaffLeaveFields({ subject }: { subject: ApplicationSubject }) {
  const { t } = useTranslation('applicationForms');
  const { t: tLeave } = useTranslation('leave');
  const staffProfileId = subject.kind === 'STAFF' ? subject.staffProfileId : '';
  const balances = useLeaveBalance(staffProfileId);
  const [leaveType, start] = useWatch({ name: ['leave_type', 'start_date'] }) as [string, string];

  // `null` quota / balance means "no limit" (D19), never zero.
  const row = balances.data?.find((b) => b.leave_type === leaveType);
  const hint = row
    ? row.balance === null
      ? t('help.unlimited')
      : t('help.balanceLeft', { count: row.balance })
    : undefined;

  return (
    <>
      <SelectField
        name="leave_type"
        label={t('fields.leaveType')}
        hint={hint}
        wide
        options={Object.values(LeaveType).map((v) => ({ value: v, label: tLeave(`type.${v}`) }))}
      />
      <DateField name="start_date" label={t('fields.startDate')} />
      <DateField name="end_date" label={t('fields.endDate')} min={start} />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}

export function StudentLeaveFields() {
  const { t } = useTranslation('applicationForms');
  const { t: tApp } = useTranslation('applications');
  const start = useWatch({ name: 'start_date' }) as string;
  return (
    <>
      <SelectField
        name="reason_kind"
        label={t('fields.reasonKind')}
        wide
        options={Object.values(StudentLeaveReason).map((v) => ({
          value: v,
          label: tApp(`reasons.${v}`),
        }))}
      />
      <DateField name="start_date" label={t('fields.startDate')} />
      <DateField
        name="end_date"
        label={t('fields.endDate')}
        min={start}
        hint={t('help.backdate')}
      />
      <TextField name="details" label={t('fields.details')} rows={3} wide />
    </>
  );
}
