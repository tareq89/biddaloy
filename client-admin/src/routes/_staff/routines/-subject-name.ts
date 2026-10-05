import type { Subject } from '@biddaloy/ui/hooks';

/** Subject label for the UI language: `name_bn` on a Bangla screen when it
 * is set, else `name_en`. Missing subject → "—", never the id (D9). */
export function subjectName(
  subject: Pick<Subject, 'name_en' | 'name_bn'> | undefined,
  language: string,
): string {
  if (!subject) return '—';
  return language.startsWith('bn') && subject.name_bn ? subject.name_bn : subject.name_en;
}
