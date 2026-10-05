/** Subject label in the UI language; falls back to the other name, then '—'. */
export function subjectName(
  subject: { name_en: string; name_bn?: string | null } | undefined,
  language: string,
): string {
  if (!subject) return '—';
  const name = language.startsWith('bn')
    ? subject.name_bn || subject.name_en
    : subject.name_en || subject.name_bn;
  return name || '—';
}
