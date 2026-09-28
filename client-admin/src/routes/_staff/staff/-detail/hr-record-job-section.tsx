/**
 * [23.9] Job-info section of the HR record tab — full read/edit for
 * `StaffHrRecord` ([23.2]'s `staff-hr-records`). Empty state ("not filled
 * in yet") when the user has no record, since `POST /staff-hr-records`
 * only ever creates the first one — this section create()s or update()s
 * depending on whether `useStaffHrRecord` resolved a row.
 */
import { Button, EmptyState, Input, SkeletonFieldList } from '@biddaloy/ui/components';
import {
  useCreateStaffHrRecord,
  useStaffHrRecord,
  useUpdateStaffHrRecord,
  type StaffHrRecord,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface HrRecordJobSectionProps {
  userId: string;
}

type FormState = {
  index_no: string;
  salary_code: string;
  mpo_date: string;
  salary_scale: string;
  department: string;
  blood_group: string;
  religion: string;
};

const EMPTY_FORM: FormState = {
  index_no: '',
  salary_code: '',
  mpo_date: '',
  salary_scale: '',
  department: '',
  blood_group: '',
  religion: '',
};

function toFormState(record: StaffHrRecord | null): FormState {
  if (record === null) return EMPTY_FORM;
  return {
    index_no: record.index_no ?? '',
    salary_code: record.salary_code ?? '',
    mpo_date: record.mpo_date ?? '',
    salary_scale: record.salary_scale ?? '',
    department: record.department ?? '',
    blood_group: record.blood_group ?? '',
    religion: record.religion ?? '',
  };
}

export function HrRecordJobSection({ userId }: HrRecordJobSectionProps) {
  const { t } = useTranslation('staff');
  const recordQuery = useStaffHrRecord(userId);
  const createRecord = useCreateStaffHrRecord();
  const record = recordQuery.data ?? null;
  const updateRecord = useUpdateStaffHrRecord(record?.id ?? '', userId);

  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);

  React.useEffect(() => {
    if (!editing) setForm(toFormState(record));
  }, [record, editing]);

  const saving = createRecord.isPending || updateRecord.isPending;
  const saveError = createRecord.isError || updateRecord.isError;

  function startEditing() {
    setForm(toFormState(record));
    setEditing(true);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = {
      index_no: form.index_no.trim(),
      salary_code: form.salary_code.trim(),
      mpo_date: form.mpo_date.trim(),
      salary_scale: form.salary_scale.trim(),
      department: form.department.trim(),
      blood_group: form.blood_group.trim(),
      religion: form.religion.trim(),
    };
    const onSuccess = () => setEditing(false);
    if (record === null) {
      // exactOptionalPropertyTypes: omit empty fields entirely rather than
      // setting them to undefined — there's no existing value to clear yet.
      const payload = Object.fromEntries(
        Object.entries(trimmed).filter(([, value]) => value !== ''),
      ) as Partial<typeof trimmed>;
      createRecord.mutate({ user_id: userId, ...payload }, { onSuccess });
    } else {
      // A cleared field must be sent as null so the server actually clears
      // it — omitting it here would leave the record's current value in place.
      const payload = Object.fromEntries(
        Object.entries(trimmed).map(([key, value]) => [key, value === '' ? null : value]),
      ) as { [K in keyof typeof trimmed]: string | null };
      updateRecord.mutate(payload, { onSuccess });
    }
  }

  if (recordQuery.isPending) {
    return <SkeletonFieldList fields={4} />;
  }

  if (!editing && record === null) {
    return (
      <EmptyState
        title={t('hrRecord.job.emptyTitle')}
        explanation={t('hrRecord.job.emptyExplanation')}
        action={{ label: t('hrRecord.job.addAction'), onClick: startEditing }}
      />
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {(
            [
              ['index_no', 'indexNoLabel'],
              ['salary_code', 'salaryCodeLabel'],
              ['mpo_date', 'mpoDateLabel'],
              ['salary_scale', 'salaryScaleLabel'],
              ['department', 'departmentLabel'],
              ['blood_group', 'bloodGroupLabel'],
              ['religion', 'religionLabel'],
            ] as const
          ).map(([field, labelKey]) => (
            <div key={field}>
              <dt className="text-sm text-muted-foreground">{t(`hrRecord.job.${labelKey}`)}</dt>
              <dd>{record?.[field] ?? t('detail.profile.emptyValue')}</dd>
            </div>
          ))}
        </dl>
        <Button type="button" variant="outline" className="self-start" onClick={startEditing}>
          {t('hrRecord.job.editAction')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(
          [
            ['index_no', 'indexNoLabel'],
            ['salary_code', 'salaryCodeLabel'],
            ['mpo_date', 'mpoDateLabel'],
            ['salary_scale', 'salaryScaleLabel'],
            ['department', 'departmentLabel'],
            ['blood_group', 'bloodGroupLabel'],
            ['religion', 'religionLabel'],
          ] as const
        ).map(([field, labelKey]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`hr-job-${field}`} className="text-sm font-medium">
              {t(`hrRecord.job.${labelKey}`)}
            </label>
            <Input
              id={`hr-job-${field}`}
              value={form[field]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [field]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {t('hrRecord.job.errorMessage')}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          {saving ? t('hrRecord.job.saving') : t('hrRecord.job.save')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditing(false)}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
      </div>
    </form>
  );
}
