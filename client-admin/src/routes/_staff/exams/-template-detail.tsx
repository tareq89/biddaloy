/**
 * [35.4.5] Exam structure detail, redesigned in [31.4.exams-3b] — `DetailShell`
 * without tabs: the header holds the facts, an unsaved badge and Save / Discard
 * (the grid owns the draft and answers through a `ref`); rename + type live in a
 * small dialog. No route here ([35.4.9]); the route passes the id and the
 * selected class grade.
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useAllSubjects, useHasPermission } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { RotateCcw, Save } from 'lucide-react';
import * as React from 'react';

import { PresetWarningBanner } from '../../../components/PresetWarningBanner';

import { subjectLabel } from './-detail/subject-label';
import { TemplateFormDialog } from './-template-form-dialog';
import { TemplateGrid, type TemplateGridHandle } from './-template-grid';
import { useExamTemplate, useUpdateExamTemplate } from './use-exam-templates';

export interface TemplateDetailProps {
  templateId: string;
  selectedGrade?: number | undefined;
  onGradeChange?: (grade: number) => void;
}

export function TemplateDetail({ templateId, selectedGrade, onGradeChange }: TemplateDetailProps) {
  const { t, i18n } = useTranslation('examTemplates');
  const { t: tExams } = useTranslation('exams');
  const config = useRegionConfig();
  const query = useExamTemplate(templateId);
  const subjectsQuery = useAllSubjects();
  const update = useUpdateExamTemplate(templateId);
  // The banner's status call is ADMIN-only; skip it for other viewers.
  const canSeePresetBanner = useHasPermission(Permission.CURRICULUM_PRESET_APPLY);
  const gridRef = React.useRef<TemplateGridHandle>(null);
  const [dirty, setDirty] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);

  const subjects = React.useMemo(
    () =>
      (subjectsQuery.data ?? []).map((s) => ({
        code: s.code,
        name: s.name_en,
        label: subjectLabel(s, i18n.language),
      })),
    [subjectsQuery.data, i18n.language],
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState message={t('detail.loadError')} onRetry={() => void query.refetch()} />;
  }
  const template = query.data;
  const saving = update.isPending && update.variables?.rows !== undefined;
  const grades = [...new Set(template.rows.map((r) => r.classGrade))].sort((a, b) => a - b);
  const parts = template.rows.reduce((sum, r) => sum + r.components.length, 0);

  return (
    <>
      <DetailShell
        name={template.name}
        {...(dirty ? { statusBadge: <StatusBadge tone="warning" label={t('detail.unsaved')} /> } : {})}
        facts={[
          { label: t('detail.facts.kind'), value: tExams(`kind.${template.kind}`) },
          {
            label: t('detail.facts.grades'),
            value: grades.map((g) => formatNumber(g, config)).join(', ') || '—',
          },
          {
            label: t('detail.facts.subjects'),
            value: t('detail.facts.count', { count: formatNumber(template.rows.length, config) }),
          },
          {
            label: t('detail.facts.parts'),
            value: t('detail.facts.count', { count: formatNumber(parts, config) }),
          },
        ]}
        actions={[
          {
            id: 'discard',
            label: t('detail.discard'),
            icon: <RotateCcw aria-hidden className="size-4" />,
            priority: 'secondary',
            allowed: dirty,
            disabled: saving,
            onClick: () => gridRef.current?.discard(),
          },
          {
            id: 'save',
            label: t('detail.save'),
            icon: <Save aria-hidden className="size-4" />,
            priority: 'primary',
            disabled: !dirty,
            busy: saving,
            onClick: () => gridRef.current?.save(),
          },
          {
            id: 'edit',
            label: t('detail.editName'),
            priority: 'tertiary',
            onClick: () => setEditOpen(true),
          },
        ]}
      >
        {canSeePresetBanner && <PresetWarningBanner />}
        {update.isError && update.variables?.rows !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {t('detail.saveError')}
          </p>
        )}
        <TemplateGrid
          ref={gridRef}
          rows={template.rows}
          subjects={subjects}
          selectedGrade={selectedGrade}
          {...(onGradeChange ? { onGradeChange } : {})}
          onStateChange={({ dirty: next }) => setDirty(next)}
          onSave={(rows) => update.mutate({ rows })}
        />
      </DetailShell>

      <TemplateFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => setEditOpen(false)}
        initial={{ id: template.id, name: template.name, kind: template.kind }}
      />
    </>
  );
}
