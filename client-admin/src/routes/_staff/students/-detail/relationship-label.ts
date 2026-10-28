import { useTranslation } from '@biddaloy/ui/i18n';

const KNOWN_RELATIONSHIPS = [
  'father',
  'mother',
  'brother',
  'sister',
  'grandfather',
  'grandmother',
  'uncle',
  'aunt',
  'other',
];

/** A guardian's relationship is free text: known English values are translated, anything else
 * is shown as typed. Shared by the Guardians tab and the My class "Add yourself" picker. */
export function useRelationshipLabel(): (relationship: string) => string {
  const { t } = useTranslation('common');
  return (relationship) => {
    const key = relationship.trim().toLowerCase();
    return KNOWN_RELATIONSHIPS.includes(key) ? t(`enums.relationship.${key}`) : relationship;
  };
}
