import { useTranslation } from '@biddaloy/ui/i18n';

import { TextField } from './fields';

/** Addressee and tags are the next step of the new page (52.5.3), not here. */
export function GeneralFields() {
  const { t } = useTranslation('applicationForms');
  return (
    <>
      <TextField name="subject_line" label={t('fields.subjectLine')} wide />
      <TextField name="body" label={t('fields.body')} rows={8} wide />
    </>
  );
}
