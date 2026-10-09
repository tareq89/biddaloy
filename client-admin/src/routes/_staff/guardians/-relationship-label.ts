import type { TFunction } from 'i18next';

export const RELATIONSHIP_VALUES = [
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'Grandfather',
  'Grandmother',
  'Uncle',
  'Aunt',
  'Other',
] as const;

/** Stored value -> translated label; free text a person typed is shown as typed. */
export function relationshipLabel(value: string | null | undefined, t: TFunction): string {
  const raw = (value ?? '').trim();
  if (raw === '') return '—';
  const key = raw.toLowerCase();
  return RELATIONSHIP_VALUES.some((v) => v.toLowerCase() === key)
    ? t(`enums.relationship.${key}`, { ns: 'common' })
    : raw;
}
