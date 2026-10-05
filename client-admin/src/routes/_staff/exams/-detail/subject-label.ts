/** Bangla name on Bangla screens when the subject has one, else the English name. */
export function subjectLabel(
  subject: { name_en: string | null; name_bn?: string | null },
  language: string,
): string {
  return (language.startsWith('bn') && subject.name_bn) || subject.name_en || '—';
}
