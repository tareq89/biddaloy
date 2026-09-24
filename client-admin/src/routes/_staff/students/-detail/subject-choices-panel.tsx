/**
 * Fourth-subject panel — [19.6.1], mounted as a tab on student detail.
 * Lists the optional subjects offered to this student's class/year as
 * radio buttons; selecting one replaces any previous fourth-subject
 * choice — `SubjectChoicesService.setChoice` is an idempotent PUT
 * (#899/#900), so re-selecting just overwrites the prior row rather than
 * requiring the panel to clear anything first.
 */
import { ErrorState, RadioGroup, RadioGroupItem, Skeleton } from '@biddaloy/ui/components';
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
  const { t } = useTranslation('exams');
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
    return <Skeleton className="h-24 w-full" />;
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

  const subjectNameById = new Map((subjectsQuery.data?.data ?? []).map((s) => [s.id, s.name_en]));
  const options = optionsQuery.data ?? [];
  const currentFourth = options.find((o) => o.is_fourth);

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('subjectChoicesPanel.empty')}</p>;
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t('subjectChoicesPanel.label')}</legend>
      <RadioGroup
        value={currentFourth?.class_subject_id ?? ''}
        onValueChange={(classSubjectId) =>
          setChoice.mutate({ class_subject_id: classSubjectId, is_fourth: true })
        }
      >
        {options.map((option) => (
          <label key={option.class_subject_id} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={option.class_subject_id} disabled={setChoice.isPending} />
            {subjectNameById.get(option.subject_id) ?? option.subject_id}
          </label>
        ))}
      </RadioGroup>
      {setChoice.isError && (
        <p role="alert" className="text-sm text-destructive">
          {setChoice.error instanceof Error
            ? setChoice.error.message
            : t('subjectChoicesPanel.errorMessage')}
        </p>
      )}
    </fieldset>
  );
}
