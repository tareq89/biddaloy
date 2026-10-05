/** [39.3.3] Religion / birth reg no / parents / health notes. Photo, blood group, Bangla name are out (D6). */
import { Permission } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Button, Card, Input, Textarea } from '@biddaloy/ui/components';
import { useHasPermission, useUpdateStudentRecords, type Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export function ProfileFieldsForm({ student }: { student: Student }) {
  const { t } = useTranslation('student-records');
  const canWrite = useHasPermission(Permission.STUDENT_RECORDS_WRITE);
  const canSeeHealth = useHasPermission(Permission.STUDENT_RECORDS_READ);
  const update = useUpdateStudentRecords(student.id);

  const server = React.useMemo(
    () => ({
      religion: student.religion ?? '',
      birth_reg_no: student.birth_reg_no ?? '',
      father_name: student.father_name ?? '',
      mother_name: student.mother_name ?? '',
      health_notes: student.health_notes ?? '',
    }),
    [
      student.religion,
      student.birth_reg_no,
      student.father_name,
      student.mother_name,
      student.health_notes,
    ],
  );
  type Values = typeof server;
  type Key = keyof Values;
  const [values, setValues] = React.useState<Values>(server);
  // Last server values the form was seeded with; a field is "dirty" when it differs.
  const baseline = React.useRef<Values>(server);
  const seededId = React.useRef(student.id);
  React.useEffect(() => {
    const prev = baseline.current;
    const sameStudent = seededId.current === student.id;
    baseline.current = server;
    seededId.current = student.id;
    // Fresh server data (background refetch) overwrites only untouched fields;
    // another student reseeds everything.
    setValues((cur) =>
      sameStudent
        ? (Object.fromEntries(
            (Object.keys(server) as Key[]).map((k) => [k, cur[k] === prev[k] ? server[k] : cur[k]]),
          ) as Values)
        : server,
    );
  }, [server, student.id]);
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
        onSuccess: () => {
          // Reseed from what was saved: nothing is dirty any more.
          const saved = Object.fromEntries(
            (Object.keys(values) as Key[]).map((k) => [
              k,
              k === 'health_notes' && !canSeeHealth ? values[k] : values[k].trim(),
            ]),
          ) as Values;
          baseline.current = saved;
          // Keep anything typed while the save was in flight (it stays dirty).
          setValues(
            (cur) =>
              Object.fromEntries(
                (Object.keys(saved) as Key[]).map((k) => [
                  k,
                  cur[k] === values[k] ? saved[k] : cur[k],
                ]),
              ) as Values,
          );
          notifyOutcome({ tenantId, variant: 'success', message: t('profile.saved') });
        },
      },
    );
  }

  const field = (id: string, key: Key, label: string) =>
    canWrite ? (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <Input id={id} value={values[key]} onChange={(e) => set(key, e.target.value)} />
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        <dt className="text-caption text-text-secondary">{label}</dt>
        <dd>{values[key] === '' ? '—' : values[key]}</dd>
      </div>
    );

  const grid = (children: React.ReactNode) =>
    canWrite ? (
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    ) : (
      <dl className="mt-4 grid gap-4 md:grid-cols-2">{children}</dl>
    );

  return (
    <Card padded asChild>
      <form onSubmit={handleSubmit} aria-labelledby="profile-title">
        <h2 id="profile-title" className="text-h2">
          {t('profile.title')}
        </h2>
        {grid(
          <>
            {field('sr-religion', 'religion', t('profile.religion'))}
            {field('sr-birth-reg', 'birth_reg_no', t('profile.birthRegNo'))}
            {field('sr-father', 'father_name', t('profile.fatherName'))}
            {field('sr-mother', 'mother_name', t('profile.motherName'))}
            {canSeeHealth &&
              (canWrite ? (
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label htmlFor="sr-health" className="font-medium">
                    {t('profile.healthNotes')}
                  </label>
                  <Textarea
                    id="sr-health"
                    rows={3}
                    value={values.health_notes}
                    onChange={(e) => set('health_notes', e.target.value)}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 md:col-span-2">
                  <dt className="text-caption text-text-secondary">{t('profile.healthNotes')}</dt>
                  <dd className="whitespace-pre-wrap">
                    {values.health_notes === '' ? '—' : values.health_notes}
                  </dd>
                </div>
              ))}
          </>,
        )}
        {update.isError && (
          <p role="alert" className="mt-4 text-destructive">
            {t('profile.saveError')}
          </p>
        )}
        {canWrite && (
          <div className="mt-4 flex justify-end border-t border-border-subtle pt-4">
            <Button
              type="submit"
              variant="outline"
              className="w-full md:w-auto"
              loading={update.isPending}
            >
              {update.isPending ? t('profile.saving') : t('profile.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
