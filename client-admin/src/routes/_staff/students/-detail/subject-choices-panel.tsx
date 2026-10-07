/**
 * Subject choices panel — [19.6.1] fourth subject + [35.1.13] choice groups, mounted as a tab on student detail.
 * Lists the optional subjects offered to this student's class/year as
 * radio buttons; selecting one replaces any previous fourth-subject
 * choice — `SubjectChoicesService.setChoice` is an idempotent PUT
 * (#899/#900), so re-selecting just overwrites the prior row rather than
 * requiring the panel to clear anything first.
 */
import {
  Card,
  EmptyState,
  ErrorState,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useSetSubjectChoice,
  useSubjectChoiceOptions,
  useSubjects,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface SubjectChoicesPanelProps {
  studentId: string;
}

export function SubjectChoicesPanel({ studentId }: SubjectChoicesPanelProps) {
  const { t, i18n } = useTranslation('exams');
  const { t: tStudents } = useTranslation('students');
  const academicYearsQuery = useAcademicYears();
  const currentYearId = academicYearsQuery.data?.data.find((y) => y.is_current)?.id;

  const optionsQuery = useSubjectChoiceOptions(studentId, currentYearId);
  const subjectsQuery = useSubjects({ limit: 100 });
  const setChoice = useSetSubjectChoice(studentId, currentYearId);

  // `optionsQuery` is disabled until `currentYearId` resolves, so its own
  // isLoading is false while academicYearsQuery is still in flight — check
  // that one explicitly, or the panel would flash "no options" instead of
  // staying in the loading state.
  if (academicYearsQuery.isLoading || optionsQuery.isLoading || subjectsQuery.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  if (academicYearsQuery.isError || optionsQuery.isError)
    return (
      <ErrorState
        message={t('subjectChoicesPanel.loadError')}
        onRetry={() => {
          if (academicYearsQuery.isError) void academicYearsQuery.refetch();
          if (optionsQuery.isError) void optionsQuery.refetch();
        }}
      />
    );
  // Subject names come from this query — surfacing a raw subject_id
  // instead of a name (the `?? option.subject_id` fallback below) after a
  // failure isn't acceptable UX for a radio group the student's guardian
  // may act on, so this failure gets the same retry treatment.
  if (subjectsQuery.isError)
    return (
      <ErrorState
        message={t('subjectChoicesPanel.loadError')}
        onRetry={() => void subjectsQuery.refetch()}
      />
    );

  const subjectById = new Map((subjectsQuery.data?.data ?? []).map((s) => [s.id, s]));
  const options = optionsQuery.data ?? [];
  const fourthOptions = options.filter((o) => o.choice_group === null);
  const groups = new Map<string, typeof options>();
  for (const o of options) {
    if (o.choice_group !== null)
      groups.set(o.choice_group, [...(groups.get(o.choice_group) ?? []), o]);
  }
  const currentFourth = fourthOptions.find((o) => o.is_fourth);
  // Reader's language with an English fallback; an unknown id shows a dash, never the id.
  const nameOf = (id: string) => {
    const subject = subjectById.get(id);
    if (!subject) return tStudents('list.emptyValue');
    return i18n.language === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en;
  };

  if (options.length === 0) {
    return (
      <EmptyState
        title={t('subjectChoicesPanel.empty')}
        explanation={tStudents('detail.subjects.emptyExplanation')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {[...groups].map(([group, members]) => {
        const picked = members.find((o) => o.chosen);
        return (
          <Card padded key={group}>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-h3">{group}</legend>
              <RadioGroup
                value={picked?.class_subject_id ?? ''}
                onValueChange={(classSubjectId) =>
                  setChoice.mutate({ class_subject_id: classSubjectId, is_fourth: false })
                }
              >
                {members.map((option) => (
                  <label
                    key={option.class_subject_id}
                    className="flex min-h-11 items-center gap-3 md:min-h-8"
                  >
                    <RadioGroupItem value={option.class_subject_id} />
                    {nameOf(option.subject_id)}
                  </label>
                ))}
              </RadioGroup>
              {!picked && (
                <p className="text-text-secondary">{t('subjectChoicesPanel.groupUnpicked')}</p>
              )}
            </fieldset>
          </Card>
        );
      })}
      {fourthOptions.length > 0 && (
        <Card padded>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-h3">{t('subjectChoicesPanel.label')}</legend>
            <RadioGroup
              value={currentFourth?.class_subject_id ?? ''}
              onValueChange={(classSubjectId) =>
                setChoice.mutate({ class_subject_id: classSubjectId, is_fourth: true })
              }
            >
              {fourthOptions.map((option) => (
                <label
                  key={option.class_subject_id}
                  className="flex min-h-11 items-center gap-3 md:min-h-8"
                >
                  <RadioGroupItem value={option.class_subject_id} disabled={setChoice.isPending} />
                  {nameOf(option.subject_id)}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        </Card>
      )}
      {setChoice.isError && (
        <p role="alert" className="text-destructive">
          {t('subjectChoicesPanel.errorMessage')}
        </p>
      )}
    </div>
  );
}
