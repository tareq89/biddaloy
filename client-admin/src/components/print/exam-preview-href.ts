/** The `/print/preview` link of an exam document; `from` brings the person back to the exam's Print tab. */
export function examPreviewHref(
  examId: string,
  kind: string,
  extra: Record<string, string> = {},
): string {
  return `/print/preview?${new URLSearchParams({
    kind,
    subject_type: 'STUDENT',
    context_type: 'EXAM',
    context_id: examId,
    from: `/exams/${examId}?tab=print`,
    ...extra,
  }).toString()}`;
}
