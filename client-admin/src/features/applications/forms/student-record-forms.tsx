import { useClasses, useClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { useFormContext, useWatch } from 'react-hook-form';

import { DateField, SelectField, TextField } from './fields';
import type { ApplicationSubject } from './registry';

export function TransferCertificateFields() {
  const { t } = useTranslation('applicationForms');
  return (
    <>
      <DateField name="leaving_date" label={t('fields.leavingDate')} />
      <TextField name="destination" label={t('fields.destination')} required={false} />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}

export function ReadmissionFields() {
  const { t } = useTranslation('applicationForms');
  const regionConfig = useRegionConfig();
  const { setValue } = useFormContext();
  const classId = useWatch({ name: 'class_id' }) as string;
  const classes = useClasses();
  const sections = useClassSections(classId || undefined);

  return (
    <>
      <SelectField
        name="class_id"
        label={t('fields.class')}
        options={(classes.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        // A different class has different sections: drop the old pick.
        onChange={() => setValue('class_section_id', '', { shouldValidate: false })}
      />
      <SelectField
        name="class_section_id"
        label={t('fields.section')}
        disabled={!classId}
        options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.section_name }))}
      />
      <DateField
        name="occurred_on"
        label={t('fields.occurredOn')}
        max={tenantTodayIso(regionConfig)}
      />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}

export function SectionChangeFields({ subject }: { subject: ApplicationSubject }) {
  const { t } = useTranslation('applicationForms');
  const classId = subject.kind === 'STUDENT' ? subject.classId : undefined;
  const currentSectionId = subject.kind === 'STUDENT' ? subject.sectionId : undefined;
  const sections = useClassSections(classId);

  return (
    <>
      <SelectField
        name="to_section_id"
        label={t('fields.toSection')}
        wide
        options={(sections.data ?? [])
          .filter((s) => s.id !== currentSectionId)
          .map((s) => ({ value: s.id, label: s.section_name }))}
      />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}
