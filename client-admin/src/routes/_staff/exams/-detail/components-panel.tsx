/**
 * Setup tab — [19.6.1]. Per-subject `ExamComponent` rows (name, kind,
 * full/pass marks, sequence) plus an inline add-row form and the D9 copy
 * dialog. `kind = ATTENDANCE` forces `source = DERIVED` and hides the
 * marks input (issue rule #5, D11) — an ATTENDANCE component's marks are
 * computed by the server, never entered.
 */
import { ExamComponentKind, ExamComponentSource, Permission } from '@biddaloy/shared';
import {
  Button,
  ErrorState,
  Input,
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
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { CopyComponentsDialog } from '../-copy-components-dialog';

const COMPONENT_KINDS = Object.values(ExamComponentKind);

export interface ComponentsPanelProps {
  examId: string;
  classId: string;
  academicYearId: string;
}

export function ComponentsPanel({ examId, classId, academicYearId }: ComponentsPanelProps) {
  const { t } = useTranslation('exams');
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const classSubjectsQuery = useClassSubjects(classId, academicYearId);
  const [selectedSubjectId, setSelectedSubjectId] = React.useState<string | undefined>(undefined);
  const [copyOpen, setCopyOpen] = React.useState(false);

  const subjects = classSubjectsQuery.data ?? [];
  const activeSubjectId = selectedSubjectId ?? subjects[0]?.subject_id;

  const componentsQuery = useExamComponents(examId, activeSubjectId);
  const createComponent = useCreateExamComponent(examId, activeSubjectId);
  const deleteComponent = useDeleteExamComponent(examId, activeSubjectId);

  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<string>(ExamComponentKind.WRITTEN);
  const [fullMarks, setFullMarks] = React.useState('');
  const [passMarks, setPassMarks] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const isAttendance = kind === ExamComponentKind.ATTENDANCE;

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!activeSubjectId) return;
    if (!name.trim()) {
      setFormError(t('componentsPanel.errorNameRequired'));
      return;
    }
    if (!isAttendance && (!fullMarks.trim() || Number(fullMarks) <= 0)) {
      setFormError(t('componentsPanel.errorFullMarksInvalid'));
      return;
    }
    setFormError(null);
    const existing = componentsQuery.data ?? [];
    const nextSequence = existing.reduce((max, c) => Math.max(max, c.sequence), 0) + 1;

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={activeSubjectId ?? ''} onValueChange={setSelectedSubjectId}>
          <SelectTrigger aria-label={t('componentsPanel.subjectLabel')}>
            <SelectValue placeholder={t('componentsPanel.subjectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.subject_id} value={s.subject_id}>
                {s.subject.name_en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
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
        <table className="w-full text-sm">
          <caption className="sr-only">{t('componentsPanel.tableCaption')}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">{t('componentsPanel.columnName')}</th>
              <th className="py-2">{t('componentsPanel.columnKind')}</th>
              <th className="py-2">{t('componentsPanel.columnFullMarks')}</th>
              <th className="py-2">{t('componentsPanel.columnPassMarks')}</th>
              <th className="py-2">{t('componentsPanel.columnSequence')}</th>
              {canManage && <th className="py-2">{t('componentsPanel.columnActions')}</th>}
            </tr>
          </thead>
          <tbody>
            {(componentsQuery.data ?? [])
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((component) => (
                <tr key={component.id} className="border-b">
                  <td className="py-2">{component.name}</td>
                  <td className="py-2">{t(`componentKind.${component.kind}`)}</td>
                  <td className="py-2">
                    {component.source === ExamComponentSource.DERIVED
                      ? t('componentsPanel.derived')
                      : component.full_marks}
                  </td>
                  <td className="py-2">{component.pass_marks ?? '—'}</td>
                  <td className="py-2">{component.sequence}</td>
                  {canManage && (
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => deleteComponent.mutate(component.id)}
                        className="text-sm font-medium text-destructive underline"
                      >
                        {t('componentsPanel.remove')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            {(componentsQuery.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  {t('componentsPanel.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {canManage && activeSubjectId && (
        <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="component-name" className="text-sm font-medium">
                {t('componentsPanel.nameLabel')}
              </label>
              <Input id="component-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('componentsPanel.kindLabel')}</span>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label={t('componentsPanel.kindLabel')}>
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
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="component-full-marks" className="text-sm font-medium">
                    {t('componentsPanel.columnFullMarks')}
                  </label>
                  <Input
                    id="component-full-marks"
                    value={fullMarks}
                    onChange={(e) => setFullMarks(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="component-pass-marks" className="text-sm font-medium">
                    {t('componentsPanel.columnPassMarks')}
                  </label>
                  <Input
                    id="component-pass-marks"
                    value={passMarks}
                    onChange={(e) => setPassMarks(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              </>
            )}
            <Button type="submit" loading={createComponent.isPending}>
              {t('componentsPanel.add')}
            </Button>
          </div>
          {isAttendance && (
            <p className="text-sm text-muted-foreground">{t('componentsPanel.attendanceHint')}</p>
          )}
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {createComponent.isError && (
            <p role="alert" className="text-sm text-destructive">
              {createComponent.error instanceof Error
                ? createComponent.error.message
                : t('componentsPanel.errorMessage')}
            </p>
          )}
        </form>
      )}

      {canManage && (
        <CopyComponentsDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          examId={examId}
          classId={classId}
          subjects={subjects.map((s) => ({ subject_id: s.subject_id, name: s.subject.name_en }))}
        />
      )}
    </div>
  );
}
