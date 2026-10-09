/** [39.3.3] Public-exam rows with add / edit / delete dialogs (write-gated). */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
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
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useDeletePublicExam,
  useHasPermission,
  usePublicExams,
  useSavePublicExam,
  type StudentPublicExam,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';

import { TabQueryState } from '../tab-query-state';

const EXAM_TYPES = ['PSC', 'JSC', 'SSC', 'DAKHIL', 'HSC', 'ALIM'] as const;
type ExamType = (typeof EXAM_TYPES)[number];

export function PublicExamsSection({ studentId }: { studentId: string }) {
  const { t } = useTranslation('student-records');
  const regionConfig = useRegionConfig();
  const canWrite = useHasPermission(Permission.STUDENT_RECORDS_WRITE);
  const query = usePublicExams(studentId);
  // `null` = closed, `'new'` = add dialog, otherwise the row being edited.
  const [editing, setEditing] = React.useState<StudentPublicExam | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<StudentPublicExam | null>(null);

  return (
    <Card asChild className="overflow-hidden">
      <div>
        <div className="flex items-center justify-between gap-3 p-4 md:px-5">
          <h2 className="text-h2">{t('exams.title')}</h2>
          {canWrite && (
            <Button type="button" variant="outline" onClick={() => setEditing('new')}>
              <PlusIcon className="size-4" aria-hidden />
              {t('exams.add')}
            </Button>
          )}
        </div>
        <TabQueryState
          query={query}
          forbiddenMessage={t('tab.forbidden')}
          errorMessage={t('tab.error')}
        >
          {(exams) => {
            const columns: DataTableColumn<StudentPublicExam>[] = [
              {
                id: 'type',
                header: t('exams.columns.type'),
                accessorFn: (exam) => t(`exams.types.${exam.exam_type}`),
                card: 'title',
              },
              { id: 'board', header: t('exams.columns.board'), accessorFn: (exam) => exam.board },
              { id: 'roll', header: t('exams.columns.roll'), accessorFn: (exam) => exam.roll_no },
              {
                id: 'registration',
                header: t('exams.columns.registration'),
                accessorFn: (exam) => exam.registration_no,
              },
              {
                id: 'gpa',
                header: t('exams.columns.gpa'),
                align: 'end',
                accessorFn: (exam) =>
                  exam.gpa === null || exam.gpa === undefined
                    ? '—'
                    : formatNumber(Number(exam.gpa), regionConfig, { decimals: 2 }),
              },
              {
                id: 'year',
                header: t('exams.columns.year'),
                // Not `formatNumber`: it would group the digits ("২,০২৪").
                accessorFn: (exam) =>
                  renderDigits(String(exam.passing_year), regionConfig.numerals),
              },
            ];
            return (
              <DataTable
                tableId="student-public-exams"
                caption={t('exams.title')}
                paginated={false}
                sorting={null}
                onSortingChange={() => {}}
                columns={columns}
                data={exams}
                getRowId={(exam) => exam.id}
                totalCount={exams.length}
                rowActions={(exam) => [
                  {
                    intent: 'edit',
                    label: t('exams.edit'),
                    onClick: () => setEditing(exam),
                    allowed: canWrite,
                  },
                  {
                    intent: 'delete',
                    label: t('exams.delete'),
                    onClick: () => setDeleting(exam),
                    allowed: canWrite,
                  },
                ]}
                emptyState={{ title: t('exams.empty'), explanation: '' }}
              />
            );
          }}
        </TabQueryState>

        {canWrite && editing !== null && (
          <ExamDialog
            studentId={studentId}
            exam={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
        {canWrite && deleting !== null && (
          <DeleteExamDialog
            studentId={studentId}
            exam={deleting}
            onClose={() => setDeleting(null)}
          />
        )}
      </div>
    </Card>
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
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{t('exams.form.type')}</span>
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
            <p role="alert" className="text-destructive">
              {t('exams.form.saveError')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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
      <label htmlFor={id} className="font-medium">
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
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      tone="danger"
      title={t('exams.deleteConfirm.title')}
      description={`${t(`exams.types.${exam.exam_type}`)} · ${exam.passing_year}. ${t('exams.deleteConfirm.body')}`}
      confirmLabel={t('exams.deleteConfirm.confirm')}
      busy={del.isPending}
      onConfirm={() =>
        del.mutate(exam.id, {
          onSuccess: onClose,
          onError: () => toast.error(t('exams.deleteConfirm.error')),
        })
      }
    />
  );
}
