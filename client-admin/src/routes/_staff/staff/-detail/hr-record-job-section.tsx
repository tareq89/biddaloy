/**
 * [23.9] Job-info section of the HR record tab — full read/edit for
 * `StaffHrRecord` ([23.2]'s `staff-hr-records`). Empty state ("not filled
 * in yet") when the user has no record, since `POST /staff-hr-records`
 * only ever creates the first one — this section create()s or update()s
 * depending on whether `useStaffHrRecord` resolved a row.
 */
import {
  Button,
  DatePicker,
  EmptyState,
  Input,
  Label,
  SkeletonFieldList,
} from '@biddaloy/ui/components';
import {
  useCreateStaffHrRecord,
  useStaffHrRecord,
  useUpdateStaffHrRecord,
  type StaffHrRecord,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { PencilIcon } from 'lucide-react';
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
  name_bn: string;
  religion: string;
};

const EMPTY_FORM: FormState = {
  index_no: '',
  salary_code: '',
  mpo_date: '',
  salary_scale: '',
  department: '',
  blood_group: '',
  name_bn: '',
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
    name_bn: record.name_bn ?? '',
    religion: record.religion ?? '',
  };
}

const JOB_FIELDS = [
  ['index_no', 'indexNoLabel'],
  ['salary_code', 'salaryCodeLabel'],
  ['mpo_date', 'mpoDateLabel'],
  ['salary_scale', 'salaryScaleLabel'],
  ['department', 'departmentLabel'],
  ['blood_group', 'bloodGroupLabel'],
  ['name_bn', 'nameBnLabel'],
  ['religion', 'religionLabel'],
] as const;

export function HrRecordJobSection({ userId }: HrRecordJobSectionProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
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
      name_bn: form.name_bn.trim(),
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
      <div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {JOB_FIELDS.map(([field, labelKey]) => (
            <div key={field}>
              <dt className="text-caption text-text-secondary">{t(`hrRecord.job.${labelKey}`)}</dt>
              <dd>
                {field === 'mpo_date'
                  ? record?.mpo_date
                    ? formatDate(parseServerDate(record.mpo_date), regionConfig)
                    : t('detail.profile.emptyValue')
                  : (record?.[field] ?? t('detail.profile.emptyValue'))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={startEditing}>
            <PencilIcon aria-hidden="true" />
            {t('hrRecord.job.editActionShort')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {JOB_FIELDS.map(([field, labelKey]) => (
          <div key={field} className="grid min-w-0 gap-1.5">
            <Label htmlFor={`hr-job-${field}`}>{t(`hrRecord.job.${labelKey}`)}</Label>
            {field === 'mpo_date' ? (
              <DatePicker
                id="hr-job-mpo_date"
                config={regionConfig}
                aria-label={t(`hrRecord.job.${labelKey}`)}
                value={form.mpo_date ? parseServerDate(form.mpo_date) : undefined}
                onValueChange={(date) =>
                  setForm((current) => ({ ...current, mpo_date: date ? toIsoDate(date) : '' }))
                }
              />
            ) : (
              <Input
                id={`hr-job-${field}`}
                value={form[field]}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [field]: event.target.value }))
                }
              />
            )}
          </div>
        ))}
      </div>

      {saveError && (
        <p role="alert" className="text-caption text-destructive">
          {t('hrRecord.job.errorMessage')}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" onClick={() => setEditing(false)}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? t('hrRecord.job.saving') : t('hrRecord.job.save')}
        </Button>
      </div>
    </form>
  );
}
