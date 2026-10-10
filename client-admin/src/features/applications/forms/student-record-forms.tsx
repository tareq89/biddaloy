import { useClasses, useClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import * as React from 'react';
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
  const sectionId = useWatch({ name: 'class_section_id' }) as string;
  const classes = useClasses();
  const sections = useClassSections(classId || undefined);

  // A re-fed section (back-navigation) that is not in the shown class would submit unseen.
  React.useEffect(() => {
    if (sections.data && sectionId && !sections.data.some((s) => s.id === sectionId)) {
      setValue('class_section_id', '', { shouldValidate: false });
    }
  }, [sections.data, sectionId, setValue]);

  return (
    <>
      <SelectField
        name="class_id"
        label={t('fields.class')}
        source={classes}
        emptyHint={t('pickers.noClasses')}
        options={(classes.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        // A different class has different sections: drop the old pick.
        onChange={() => setValue('class_section_id', '', { shouldValidate: false })}
      />
      <SelectField
        name="class_section_id"
        label={t('fields.section')}
        disabled={!classId}
        source={sections}
        emptyHint={t('pickers.noSections')}
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
        source={sections}
        emptyHint={t('pickers.noOtherSection')}
        options={(sections.data ?? [])
          .filter((s) => s.id !== currentSectionId)
          .map((s) => ({ value: s.id, label: s.section_name }))}
      />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}
