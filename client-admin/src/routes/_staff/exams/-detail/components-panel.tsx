/**
 * Marks-breakdown tab — [19.6.1], redesigned in [31.4.exams-2b]. Per-subject
 * `ExamComponent` rows (a "part": name, kind, full/pass marks) with a running
 * full-marks total, a confirm before deleting, an add card and the copy tool
 * (`?copy=1`, full-page). `kind = ATTENDANCE` forces `source = DERIVED` and hides
 * the marks input (issue rule #5, D11) — its marks are computed by the server.
 */
import { ExamComponentKind, ExamComponentSource, Permission } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useClassSubjects,
  useCreateExamComponent,
  useDeleteExamComponent,
  useExamComponents,
  useHasPermission,
  type ExamComponent,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { getRouteApi } from '@tanstack/react-router';
import { Copy } from 'lucide-react';
import * as React from 'react';

import { CopyComponentsDialog } from '../-copy-components-dialog';

import { subjectLabel } from './subject-label';

const COMPONENT_KINDS = Object.values(ExamComponentKind);
const examRoute = getRouteApi('/_staff/exams/$examId');
// Asterisk drawn by CSS, so the label text stays exactly the field name.
const REQUIRED = "after:ms-0.5 after:text-destructive after:content-['*']";
const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';

export interface ComponentsPanelProps {
  examId: string;
  classId: string;
  academicYearId: string;
}

type FormError = { field: 'name' | 'fullMarks'; message: string };

export function ComponentsPanel({ examId, classId, academicYearId }: ComponentsPanelProps) {
  const { t, i18n } = useTranslation('exams');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const classSubjectsQuery = useClassSubjects(classId, academicYearId);
  const navigate = examRoute.useNavigate();
  const copyOpen = examRoute.useSearch({ select: (s) => s.copy === '1' });
  const [selectedSubjectId, setSelectedSubjectId] = React.useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = React.useState<ExamComponent | null>(null);

  const subjects = (classSubjectsQuery.data ?? []).map((s) => ({
    subject_id: s.subject_id,
    name: subjectLabel(s.subject, i18n.language),
  }));
  const activeSubjectId = selectedSubjectId ?? subjects[0]?.subject_id;
  const activeSubjectName = subjects.find((s) => s.subject_id === activeSubjectId)?.name ?? '';

  const componentsQuery = useExamComponents(examId, activeSubjectId);
  const createComponent = useCreateExamComponent(examId);
  const deleteComponent = useDeleteExamComponent(examId);

  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<string>(ExamComponentKind.WRITTEN);
  const [fullMarks, setFullMarks] = React.useState('');
  const [passMarks, setPassMarks] = React.useState('');
  const [formError, setFormError] = React.useState<FormError | null>(null);

  const isAttendance = kind === ExamComponentKind.ATTENDANCE;
  const rows = (componentsQuery.data ?? []).slice().sort((a, b) => a.sequence - b.sequence);
  const fullMarksTotal = rows
    .filter((c) => c.source === ExamComponentSource.MANUAL)
    .reduce((sum, c) => sum + Number(c.full_marks), 0);

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!activeSubjectId) return;
    if (!name.trim()) {
      setFormError({ field: 'name', message: t('componentsPanel.errorNameRequired') });
      return;
    }
    if (!isAttendance && (!fullMarks.trim() || Number(fullMarks) <= 0)) {
      setFormError({ field: 'fullMarks', message: t('componentsPanel.errorFullMarksInvalid') });
      return;
    }
    setFormError(null);
    const nextSequence = rows.reduce((max, c) => Math.max(max, c.sequence), 0) + 1;

    createComponent.mutate(
      {
        subject_id: activeSubjectId,
        name: name.trim(),
        kind: kind as ExamComponentKind,
        source: isAttendance ? ExamComponentSource.DERIVED : ExamComponentSource.MANUAL,
        // ATTENDANCE's marks are server-computed — a component still needs
        // a `full_marks` row to satisfy `CreateExamComponentDto`, so send a
        // conventional 100 rather than asking the user for a number that
        // is never actually used to score anything.
        full_marks: isAttendance ? '100' : fullMarks.trim(),
        ...(passMarks.trim() && !isAttendance ? { pass_marks: passMarks.trim() } : {}),
        sequence: nextSequence,
      },
      {
        onSuccess: () => {
          setName('');
          setKind(ExamComponentKind.WRITTEN);
          setFullMarks('');
          setPassMarks('');
        },
      },
    );
  }

  const closeCopy = () =>
    void navigate({ search: (prev) => ({ ...prev, copy: undefined }), replace: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exam-components-subject">{t('componentsPanel.subjectLabel')}</Label>
          <Select value={activeSubjectId ?? ''} onValueChange={setSelectedSubjectId}>
            <SelectTrigger id="exam-components-subject" className="w-full md:w-72">
              <SelectValue placeholder={t('componentsPanel.subjectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.subject_id} value={s.subject_id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, copy: '1' }), replace: true })
            }
          >
            <Copy aria-hidden className="size-4" />
            {t('componentsPanel.copyComponents')}
          </Button>
        )}
      </div>

      {componentsQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {componentsQuery.isError && (
        <ErrorState
          message={t('componentsPanel.loadError')}
          onRetry={() => void componentsQuery.refetch()}
        />
      )}

      {!componentsQuery.isLoading && !componentsQuery.isError && (
        // ponytail: DataTable's own "Total n" footer is hidden — the totals line
        // below also carries the full-marks sum. Shared request: a `footer` slot.
        <div className="flex flex-col gap-2 [&_[data-slot=table-count]]:hidden">
          <DataTable
            tableId="exam-components"
            caption={t('componentsPanel.tableCaption')}
            paginated={false}
            columns={[
              {
                id: 'name',
                header: t('componentsPanel.columnName'),
                accessorFn: (row) => <span className="font-medium">{row.name}</span>,
                card: 'title',
              },
              {
                id: 'kind',
                header: t('componentsPanel.columnKind'),
                accessorFn: (row) => t(`componentKind.${row.kind}`),
                card: 'subtitle',
              },
              {
                id: 'full_marks',
                header: t('componentsPanel.columnFullMarks'),
                accessorFn: (row) =>
                  row.source === ExamComponentSource.DERIVED
                    ? t('componentsPanel.derived')
                    : formatNumber(Number(row.full_marks), config),
                align: 'end',
              },
              {
                id: 'pass_marks',
                header: t('componentsPanel.columnPassMarks'),
                accessorFn: (row) =>
                  row.pass_marks === null ? '—' : formatNumber(Number(row.pass_marks), config),
                align: 'end',
              },
            ]}
            rowActions={(row) => [
              {
                intent: 'delete',
                label: t('componentsPanel.delete'),
                allowed: canManage,
                onClick: () => setPendingDelete(row),
              },
            ]}
            data={rows}
            getRowId={(row) => row.id}
            sorting={null}
            onSortingChange={() => {}}
            page={1}
            pageSize={Math.max(rows.length, 1)}
            totalCount={rows.length}
            onPageChange={() => {}}
            emptyState={{
              title: t('componentsPanel.emptyTitle'),
              explanation: t('componentsPanel.emptyText'),
            }}
          />
          {rows.length > 0 && (
            <p className="text-text-secondary">
              {t('componentsPanel.totals', {
                n: formatNumber(rows.length, config),
                marks: formatNumber(fullMarksTotal, config),
              })}
            </p>
          )}
        </div>
      )}

      {canManage && activeSubjectId && (
        <form onSubmit={handleAdd} className={`${CARD} p-4 md:p-5`}>
          <h2 className="text-h2">{t('componentsPanel.addTitle')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-12 md:items-end">
            <div className="flex flex-col gap-1.5 md:col-span-4">
              <Label htmlFor="component-name" className={REQUIRED}>
                {t('componentsPanel.nameLabel')}
              </Label>
              <Input
                id="component-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={formError?.field === 'name'}
              />
              {formError?.field === 'name' && (
                <p role="alert" className="text-sm text-destructive">
                  {formError.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-3">
              <Label htmlFor="component-kind">{t('componentsPanel.kindLabel')}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="component-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`componentKind.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isAttendance && (
              <>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="component-full-marks" className={REQUIRED}>
                    {t('componentsPanel.columnFullMarks')}
                  </Label>
                  <Input
                    id="component-full-marks"
                    value={fullMarks}
                    onChange={(e) => setFullMarks(e.target.value)}
                    inputMode="decimal"
                    aria-invalid={formError?.field === 'fullMarks'}
                  />
                  {formError?.field === 'fullMarks' && (
                    <p role="alert" className="text-sm text-destructive">
                      {formError.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="component-pass-marks">{t('componentsPanel.columnPassMarks')}</Label>
                  <Input
                    id="component-pass-marks"
                    value={passMarks}
                    onChange={(e) => setPassMarks(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              </>
            )}
            <Button
              type="submit"
              variant="outline"
              className="w-full md:col-span-1"
              loading={createComponent.isPending}
            >
              {t('componentsPanel.add')}
            </Button>
          </div>
          {isAttendance && (
            <p className="mt-3 text-text-secondary">{t('componentsPanel.attendanceHint')}</p>
          )}
          {createComponent.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t('componentsPanel.errorMessage')}
            </p>
          )}
        </form>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            deleteComponent.reset();
          }
        }}
        title={t('componentsPanel.deleteTitle')}
        description={`${t('componentsPanel.deleteDescription', {
          name: pendingDelete?.name ?? '',
          subject: activeSubjectName,
        })}${deleteComponent.isError ? ` ${t('componentsPanel.deleteError')}` : ''}`}
        confirmLabel={t('componentsPanel.delete')}
        busy={deleteComponent.isPending}
        onConfirm={() =>
          pendingDelete &&
          deleteComponent.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })
        }
      />

      {canManage && copyOpen && (
        <CopyComponentsDialog
          examId={examId}
          classId={classId}
          subjects={subjects}
          onClose={closeCopy}
        />
      )}
    </div>
  );
}
