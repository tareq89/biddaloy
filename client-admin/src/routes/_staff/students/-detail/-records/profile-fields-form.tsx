/** [39.3.3] Religion / birth reg no / parents / health notes. Photo, blood group, Bangla name are out (D6). */
import { Permission } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Button, Input, Textarea } from '@biddaloy/ui/components';
import { useHasPermission, useUpdateStudent, type Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export function ProfileFieldsForm({ student }: { student: Student }) {
  const { t } = useTranslation('student-records');
  const canWrite = useHasPermission(Permission.STUDENT_RECORDS_WRITE);
  const canSeeHealth = useHasPermission(Permission.STUDENT_RECORDS_READ);
  const update = useUpdateStudent(student.id);

  const [values, setValues] = React.useState({
    religion: student.religion ?? '',
    birth_reg_no: student.birth_reg_no ?? '',
    father_name: student.father_name ?? '',
    mother_name: student.mother_name ?? '',
    health_notes: student.health_notes ?? '',
  });
  type Key = keyof typeof values;
  const set = (key: Key, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite || update.isPending) return;
    // Blank clears the column (null); health_notes is only sent when the caller can see it.
    const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
    const tenantId = captureNotificationTenant();
    update.mutate(
      {
        religion: orNull(values.religion),
        birth_reg_no: orNull(values.birth_reg_no),
        father_name: orNull(values.father_name),
        mother_name: orNull(values.mother_name),
        ...(canSeeHealth ? { health_notes: orNull(values.health_notes) } : {}),
      },
      {
        onSuccess: () =>
          notifyOutcome({ tenantId, variant: 'success', message: t('profile.saved') }),
      },
    );
  }

  const field = (id: string, key: Key, label: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={values[key]}
        readOnly={!canWrite}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} aria-labelledby="profile-title">
      <h3 id="profile-title" className="text-base font-semibold">
        {t('profile.title')}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('sr-religion', 'religion', t('profile.religion'))}
        {field('sr-birth-reg', 'birth_reg_no', t('profile.birthRegNo'))}
        {field('sr-father', 'father_name', t('profile.fatherName'))}
        {field('sr-mother', 'mother_name', t('profile.motherName'))}
      </div>
      {canSeeHealth && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sr-health" className="text-sm font-medium">
            {t('profile.healthNotes')}
          </label>
          <Textarea
            id="sr-health"
            rows={3}
            value={values.health_notes}
            readOnly={!canWrite}
            onChange={(e) => set('health_notes', e.target.value)}
          />
        </div>
      )}
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('profile.saveError')}
        </p>
      )}
      {canWrite && (
        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending}>
            {update.isPending ? t('profile.saving') : t('profile.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
