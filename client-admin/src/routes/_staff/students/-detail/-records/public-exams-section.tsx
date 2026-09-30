/** [39.3.3] Public-exam rows with add / edit / delete dialogs (write-gated). */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import {
  useDeletePublicExam,
  useHasPermission,
  usePublicExams,
  useSavePublicExam,
  type StudentPublicExam,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { TabQueryState } from '../tab-query-state';

const EXAM_TYPES = ['PSC', 'JSC', 'SSC', 'DAKHIL', 'HSC', 'ALIM'] as const;
type ExamType = (typeof EXAM_TYPES)[number];

export function PublicExamsSection({ studentId }: { studentId: string }) {
  const { t } = useTranslation('student-records');
  const canWrite = useHasPermission(Permission.STUDENT_RECORDS_WRITE);
  const query = usePublicExams(studentId);
  // `null` = closed, `'new'` = add dialog, otherwise the row being edited.
  const [editing, setEditing] = React.useState<StudentPublicExam | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<StudentPublicExam | null>(null);

  return (
    <section aria-labelledby="exams-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 id="exams-title" className="text-base font-semibold">
          {t('exams.title')}
        </h3>
        {canWrite && (
          <Button type="button" size="sm" onClick={() => setEditing('new')}>
            {t('exams.add')}
          </Button>
        )}
      </div>
      <TabQueryState
        query={query}
        forbiddenMessage={t('tab.forbidden')}
        errorMessage={t('tab.error')}
      >
        {(exams) =>
          exams.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-muted-foreground">
              {t('exams.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('exams.columns.type')}</TableHead>
                  <TableHead>{t('exams.columns.board')}</TableHead>
                  <TableHead>{t('exams.columns.roll')}</TableHead>
                  <TableHead>{t('exams.columns.registration')}</TableHead>
                  <TableHead>{t('exams.columns.gpa')}</TableHead>
                  <TableHead>{t('exams.columns.year')}</TableHead>
                  {canWrite && (
                    <TableHead>
                      <span className="sr-only">{t('exams.edit')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell>{t(`exams.types.${exam.exam_type}`)}</TableCell>
                    <TableCell>{exam.board}</TableCell>
                    <TableCell>{exam.roll_no}</TableCell>
                    <TableCell>{exam.registration_no}</TableCell>
                    <TableCell>{exam.gpa ?? '—'}</TableCell>
                    <TableCell>{exam.passing_year}</TableCell>
                    {canWrite && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(exam)}
                          >
                            {t('exams.edit')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleting(exam)}
                          >
                            {t('exams.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </TabQueryState>

      {canWrite && editing !== null && (
        <ExamDialog
          studentId={studentId}
          exam={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {canWrite && deleting !== null && (
        <DeleteExamDialog studentId={studentId} exam={deleting} onClose={() => setDeleting(null)} />
      )}
    </section>
  );
}

function ExamDialog({
  studentId,
  exam,
  onClose,
}: {
  studentId: string;
  exam: StudentPublicExam | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('student-records');
  const save = useSavePublicExam(studentId);
  const [examType, setExamType] = React.useState<ExamType>(exam?.exam_type ?? 'SSC');
  const [board, setBoard] = React.useState(exam?.board ?? '');
  const [rollNo, setRollNo] = React.useState(exam?.roll_no ?? '');
  const [registrationNo, setRegistrationNo] = React.useState(exam?.registration_no ?? '');
  const [gpa, setGpa] = React.useState(exam?.gpa ?? '');
  const [year, setYear] = React.useState(exam ? String(exam.passing_year) : '');

  const gpaNumber = gpa.trim() === '' ? undefined : Number(gpa);
  const yearNumber = Number(year);
  const valid =
    board.trim() !== '' &&
    rollNo.trim() !== '' &&
    registrationNo.trim() !== '' &&
    Number.isInteger(yearNumber) &&
    yearNumber >= 1900 &&
    (gpaNumber === undefined || (Number.isFinite(gpaNumber) && gpaNumber >= 0 && gpaNumber <= 5));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || save.isPending) return;
    const body = {
      board: board.trim(),
      roll_no: rollNo.trim(),
      registration_no: registrationNo.trim(),
      passing_year: yearNumber,
      // Server: omitted = unchanged, null = clear. So erasing an existing GPA must send null.
      ...(gpaNumber !== undefined ? { gpa: gpaNumber } : exam?.gpa != null ? { gpa: null } : {}),
    };
    save.mutate(exam ? { ...body, examId: exam.id } : { ...body, exam_type: examType }, {
      onSuccess: onClose,
    });
  }

  const title = exam ? t('exams.form.editTitle') : t('exams.form.addTitle');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('exams.form.type')}</span>
            {/* exam_type is immutable on PATCH (UpdateStudentPublicExamDto has no such field). */}
            <Select
              value={examType}
              onValueChange={(v) => setExamType(v as ExamType)}
              disabled={exam !== null}
            >
              <SelectTrigger aria-label={t('exams.form.type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`exams.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField
            id="exam-board"
            label={t('exams.form.board')}
            value={board}
            onChange={setBoard}
          />
          <TextField
            id="exam-roll"
            label={t('exams.form.roll')}
            value={rollNo}
            onChange={setRollNo}
          />
          <TextField
            id="exam-reg"
            label={t('exams.form.registration')}
            value={registrationNo}
            onChange={setRegistrationNo}
          />
          <TextField
            id="exam-gpa"
            label={t('exams.form.gpa')}
            value={gpa}
            onChange={setGpa}
            inputMode="decimal"
          />
          <TextField
            id="exam-year"
            label={t('exams.form.year')}
            value={year}
            onChange={setYear}
            inputMode="numeric"
          />
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('exams.form.saveError')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={!valid} loading={save.isPending}>
              {save.isPending ? t('exams.form.saving') : t('exams.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function DeleteExamDialog({
  studentId,
  exam,
  onClose,
}: {
  studentId: string;
  exam: StudentPublicExam;
  onClose: () => void;
}) {
  const { t } = useTranslation('student-records');
  const del = useDeletePublicExam(studentId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('exams.deleteConfirm.title')}</DialogTitle>
          <DialogDescription>
            {t(`exams.types.${exam.exam_type}`)} · {exam.passing_year}.{' '}
            {t('exams.deleteConfirm.body')}
          </DialogDescription>
        </DialogHeader>
        {del.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('exams.deleteConfirm.error')}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={del.isPending}
            onClick={() => del.mutate(exam.id, { onSuccess: onClose })}
          >
            {t('exams.deleteConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
