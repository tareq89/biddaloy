/**
 * [66.2] D21/D30: "up to lesson N for exam X" markers on a plan. Edits a local
 * copy of the list; Save sends the whole list (`PUT /exam-markers`). One exam
 * has at most one marker, so adding for an exam that has one replaces it.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useExams, useSaveStudyPlanExamMarkers, type StudyPlanDetail } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleMinus } from 'lucide-react';
import * as React from 'react';

import { DialogError } from './action-errors';

type Marker = StudyPlanDetail['exam_markers'][number];

export interface ExamMarkersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StudyPlanDetail;
  /** Opened from a marker row: preselects that exam (and its lesson). */
  initialExamId?: string | undefined;
}

export function ExamMarkersDialog({
  open,
  onOpenChange,
  plan,
  initialExamId,
}: ExamMarkersDialogProps) {
  const { t } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const save = useSaveStudyPlanExamMarkers(plan.id);
  const exams =
    useExams({
      academic_year_id: plan.academic_year_id,
      class_id: plan.section.class_id,
      limit: 100,
    }).data?.data ?? [];

  const [markers, setMarkers] = React.useState<Marker[]>(plan.exam_markers);
  const [examId, setExamId] = React.useState('');
  const [lessonId, setLessonId] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setMarkers(plan.exam_markers);
    setExamId(initialExamId ?? '');
    setLessonId(plan.exam_markers.find((m) => m.exam_id === initialExamId)?.up_to_lesson_id ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const lessonNo = (id: string) => plan.lessons.findIndex((l) => l.id === id) + 1;
  const lessonTitle = (id: string) => plan.lessons.find((l) => l.id === id)?.title ?? '';

  function pickExam(id: string) {
    setExamId(id);
    // Picking an exam that has a marker shows (and will replace) its lesson.
    setLessonId(markers.find((m) => m.exam_id === id)?.up_to_lesson_id ?? '');
  }

  function addMarker() {
    const exam = exams.find((e) => e.id === examId);
    if (!exam || lessonId === '') return;
    const next: Marker = { exam_id: exam.id, exam_name: exam.name, up_to_lesson_id: lessonId };
    setMarkers((all) => [...all.filter((m) => m.exam_id !== exam.id), next]);
    setExamId('');
    setLessonId('');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    // A complete exam + lesson pick not yet added is part of what Save persists.
    const exam = exams.find((e) => e.id === examId);
    const all =
      exam && lessonId !== ''
        ? [
            ...markers.filter((m) => m.exam_id !== exam.id),
            { exam_id: exam.id, exam_name: exam.name, up_to_lesson_id: lessonId },
          ]
        : markers;
    save.mutate(
      { markers: all.map(({ exam_id, up_to_lesson_id }) => ({ exam_id, up_to_lesson_id })) },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('markers.title')}</DialogTitle>
          </DialogHeader>

          {markers.length > 0 && (
            <ul className="flex flex-col gap-2">
              {markers.map((marker) => (
                <li
                  key={marker.exam_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
                >
                  <span>
                    {t('markers.row', {
                      exam: marker.exam_name,
                      no: formatNumber(lessonNo(marker.up_to_lesson_id), config),
                      title: lessonTitle(marker.up_to_lesson_id),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    iconOnly
                    aria-label={t('markers.remove', { exam: marker.exam_name })}
                    disabled={save.isPending}
                    onClick={() => setMarkers((all) => all.filter((m) => m !== marker))}
                  >
                    <CircleMinus />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="marker-exam" className="text-label text-text-primary">
                {t('markers.exam')}
              </label>
              <Select value={examId} onValueChange={pickExam} disabled={save.isPending}>
                <SelectTrigger id="marker-exam">
                  <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="marker-lesson" className="text-label text-text-primary">
                {t('markers.upTo')}
              </label>
              <Select value={lessonId} onValueChange={setLessonId} disabled={save.isPending}>
                <SelectTrigger id="marker-lesson">
                  <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {plan.lessons.map((lesson, i) => (
                    <SelectItem key={lesson.id} value={lesson.id}>
                      {formatNumber(i + 1, config)} · {lesson.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={examId === '' || lessonId === '' || save.isPending}
              onClick={addMarker}
            >
              {t('markers.add')}
            </Button>
          </div>

          {save.isError && <DialogError>{tCommon('status.error')}</DialogError>}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={save.isPending}>
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={save.isPending}>
              {tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
