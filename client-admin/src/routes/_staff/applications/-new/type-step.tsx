import { APPLICATION_TYPES, ApplicationSubjectKind, type ApplicationType } from '@biddaloy/shared';
import { ChoiceCards } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { canFillApplicationType } from '../../../../features/applications/forms/registry';

/**
 * The types this user may file (D8). Staff-subject types need a staff profile of one's own
 * or `APPLICATION_MANAGE`; student types need `APPLICATION_MANAGE` (paper entry). Types whose
 * pickers the role cannot load (`canFillApplicationType`) are left out entirely.
 */
export function TypeStep({
  value,
  onChange,
  role,
  canManage,
  hasProfile,
}: {
  value: ApplicationType | undefined;
  onChange: (type: ApplicationType) => void;
  role: string | null;
  canManage: boolean;
  hasProfile: boolean;
}) {
  const { t } = useTranslation('applicationsNew');
  const { t: tApp } = useTranslation('applications');
  const options = (Object.keys(APPLICATION_TYPES) as ApplicationType[])
    .filter((type) => canFillApplicationType(type, role))
    .map((type) => {
      const staff = APPLICATION_TYPES[type].subject.includes(ApplicationSubjectKind.STAFF);
      const reason = staff
        ? hasProfile || canManage
          ? undefined
          : t('type.disabledNoProfile')
        : canManage
          ? undefined
          : t('type.disabledStudent');
      return {
        value: type,
        title: tApp(`types.${type}`),
        description: t(`type.typeHelp.${type}`),
        disabled: reason !== undefined,
        ...(reason !== undefined ? { disabledReason: reason } : {}),
      };
    });
  return (
    <ChoiceCards
      label={t('type.label')}
      columns={2}
      value={value}
      options={options}
      onValueChange={(v) => onChange(v as ApplicationType)}
    />
  );
}
