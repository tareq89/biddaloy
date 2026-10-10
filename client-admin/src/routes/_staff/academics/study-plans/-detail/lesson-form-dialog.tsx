/**
 * [66.2] Add / edit one lesson. Clone of `syllabus/-syllabus-topic-form.tsx`:
 * a handful of fields, local state. The caller owns the PUT (whole list).
 */
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';
import {
  Button,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from '@biddaloy/ui/components';
import type { StudyPlanLesson, SyllabusTopic } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';

export interface LessonFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present: edit (id is kept). Absent: add. */
  lesson?: StudyPlanLesson | undefined;
  topics: SyllabusTopic[];
  isPending: boolean;
  onSubmit: (lesson: StudyPlanLesson) => void;
}

const NO_TOPIC = '';

export function LessonFormDialog({
  open,
  onOpenChange,
  lesson,
  topics,
  isPending,
  onSubmit,
}: LessonFormDialogProps) {
  const { t } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');

  const [title, setTitle] = React.useState('');
  const [periods, setPeriods] = React.useState('1');
  const [topicId, setTopicId] = React.useState<string>(NO_TOPIC);
  const [notes, setNotes] = React.useState('');
  const [titleError, setTitleError] = React.useState(false);
  const [periodsError, setPeriodsError] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTitle(lesson?.title ?? '');
    setPeriods(String(lesson?.periods ?? 1));
    setTopicId(lesson?.topic_id ?? NO_TOPIC);
    setNotes(lesson?.notes ?? '');
    setTitleError(false);
    setPeriodsError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    const count = Number(periods);
    const badTitle = trimmed === '';
    const badPeriods =
      !Number.isInteger(count) ||
      count < STUDY_PLAN_LIMITS.periodsMin ||
      count > STUDY_PLAN_LIMITS.periodsMax;
    setTitleError(badTitle);
    setPeriodsError(badPeriods);
    if (badTitle || badPeriods) return;
    onSubmit({
      id: lesson?.id ?? crypto.randomUUID(),
      title: trimmed,
      periods: count,
      ...(topicId !== NO_TOPIC ? { topic_id: topicId } : {}),
      ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
    });
  }

  const options = [
    { value: NO_TOPIC, label: '—' },
    ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{lesson ? t('lesson.editTitle') : t('lesson.addTitle')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-title" className="text-label text-text-primary">
              {t('lesson.title')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </label>
            <Input
              id="lesson-title"
              value={title}
              maxLength={STUDY_PLAN_LIMITS.titleMax}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? 'lesson-title-error' : undefined}
            />
            {titleError && <FieldError id="lesson-title-error" text={t('lesson.titleRequired')} />}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-periods" className="text-label text-text-primary">
              {t('lesson.periods')}
            </label>
            <Input
              id="lesson-periods"
              type="number"
              inputMode="numeric"
              min={STUDY_PLAN_LIMITS.periodsMin}
              max={STUDY_PLAN_LIMITS.periodsMax}
              value={periods}
              onChange={(event) => setPeriods(event.target.value)}
              aria-invalid={periodsError ? true : undefined}
              aria-describedby={periodsError ? 'lesson-periods-error' : undefined}
            />
            {periodsError && <FieldError id="lesson-periods-error" text={t('lesson.periodsMin')} />}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-topic" className="text-label text-text-primary">
              {t('lesson.topic')}
            </label>
            <Combobox
              id="lesson-topic"
              aria-label={t('lesson.topic')}
              options={options}
              value={topicId}
              onValueChange={(value) => setTopicId(value ?? NO_TOPIC)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-notes" className="text-label text-text-primary">
              {t('lesson.notes')}
            </label>
            <Textarea
              id="lesson-notes"
              value={notes}
              maxLength={STUDY_PLAN_LIMITS.notesMax}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {text}
    </p>
  );
}
