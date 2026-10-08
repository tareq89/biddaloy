import { subjectName } from '../../homework/-subject-name';

/** "৭ম-ক · গণিত · প্রথম টার্ম" — the h1 and the breadcrumb share this one string. */
export function studyPlanTitle(
  plan: {
    section: { name: string; class_name: string };
    subject: { name_en: string; name_bn: string | null };
    term: { name: string } | null;
  },
  language: string,
  wholeYear: string,
): string {
  return `${plan.section.class_name}-${plan.section.name} · ${subjectName(plan.subject, language)} · ${plan.term?.name ?? wholeYear}`;
}
