/**
 * Add a library template (from a study plan or a CSV file) or rename one. Shown only to
 * STUDY_PLAN_TEMPLATE_MANAGE holders; the server's 403 is the second line. A name clash
 * (409 `STUDY_PLAN_TEMPLATE_NAME_TAKEN`) is a field error under Name.
 */
import { STUDY_PLAN_CSV_COLUMNS } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
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
  Label,
  RadioRows,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  invalidateStudyPlanViews,
  useClasses,
  useCreateTemplateFromPlan,
  useStudyPlans,
  useSubjects,
  useUpdateStudyPlanTemplate,
  useValidateStudyPlanImport,
  type StudyPlanImportValidateResult,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { downloadCsv, formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { subjectName } from '../../homework/-subject-name';

export interface TemplateFormTarget {
  id: string;
  name: string;
  class_grade: number;
  subject_code: string;
}

type Source = 'plan' | 'csv';
const MAX_ERRORS_SHOWN = 5;

export function TemplateFormDialog({
  onClose,
  rename,
  initialSource = 'plan',
}: {
  onClose: () => void;
  /** Set for rename mode. */
  rename?: TemplateFormTarget | undefined;
  initialSource?: Source;
}) {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState(rename?.name ?? '');
  const [grade, setGrade] = React.useState(rename ? String(rename.class_grade) : '');
  const [code, setCode] = React.useState(rename?.subject_code ?? '');
  const [source, setSource] = React.useState<Source>(initialSource);
  const [planId, setPlanId] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState<
    | (Pick<
        StudyPlanImportValidateResult,
        'staging_id' | 'rows_to_create' | 'errors' | 'warnings'
      > & {
        hard_error_count: number;
      })
    | null
  >(null);
  const [nameTaken, setNameTaken] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const classes = useClasses();
  const subjects = useSubjects({ limit: 100 });
  const plans = useStudyPlans({ limit: 100 });
  const validate = useValidateStudyPlanImport();
  const fromPlan = useCreateTemplateFromPlan(planId ?? '');
  const update = useUpdateStudyPlanTemplate();

  const grades = [
    ...new Set(
      (classes.data?.data ?? []).flatMap((c) =>
        c.numeric_grade === null ? [] : [c.numeric_grade],
      ),
    ),
  ].sort((a, b) => a - b);
  const subjectList = subjects.data?.data ?? [];
  const planOptions = (plans.data?.data ?? []).map((p) => ({
    value: p.id,
    label: `${p.section.class_name}-${p.section.name} · ${subjectName(p.subject, i18n.language)} · ${p.term?.name ?? t('list.filters.wholeYear')}`,
  }));

  const isRename = rename !== undefined;
  const needsScope = isRename || source === 'csv';
  const scopeReady = !needsScope || (grade !== '' && code !== '');

  async function onFile(file: File | undefined) {
    setChecked(null);
    if (!file) return;
    try {
      const result = await validate.mutateAsync({
        file,
        target: { class_grade: Number(grade), subject_code: code },
      });
      setChecked({
        staging_id: result.staging_id,
        rows_to_create: result.summary.rows_to_create,
        errors: result.errors,
        warnings: result.summary.warnings,
        hard_error_count: result.hard_error_count,
      });
    } catch {
      setFailed(true);
    }
  }

  const canSave =
    name.trim() !== '' &&
    !saving &&
    (isRename
      ? scopeReady
      : source === 'plan'
        ? planId !== null
        : scopeReady && checked !== null && checked.hard_error_count === 0);

  async function save() {
    setSaving(true);
    setNameTaken(false);
    setFailed(false);
    try {
      const trimmed = name.trim();
      if (rename) {
        await update.mutateAsync({
          id: rename.id,
          input: { name: trimmed, class_grade: Number(grade), subject_code: code },
        });
      } else if (source === 'plan') {
        await fromPlan.mutateAsync({ name: trimmed });
      } else {
        // Direct call: the hook's error wrapper drops `ApiError.details`, which the 409 needs.
        await apiClient.post('/study-plans/import/commit', {
          staging_id: checked?.staging_id ?? '',
          template: { name: trimmed, class_grade: Number(grade), subject_code: code },
        });
        invalidateStudyPlanViews(queryClient, { templates: true });
      }
      onClose();
    } catch (e) {
      const details = (e as { details?: { code?: string } }).details;
      if (details?.code === 'STUDY_PLAN_TEMPLATE_NAME_TAKEN') setNameTaken(true);
      else setFailed(true);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent size="md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{isRename ? t('library.form.renameTitle') : t('library.add')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">{t('library.form.name')}</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTaken(false);
              }}
              aria-invalid={nameTaken}
              aria-describedby={nameTaken ? 'tpl-name-error' : undefined}
            />
            {nameTaken && (
              <p id="tpl-name-error" role="alert" className="text-sm text-destructive">
                {t('library.nameTaken')}
              </p>
            )}
          </div>

          {!isRename && (
            <RadioRows
              legend={t('library.form.source')}
              value={source}
              onValueChange={(v) => {
                setSource(v as Source);
                setChecked(null);
              }}
              options={[
                { value: 'plan', title: t('library.form.fromPlan') },
                { value: 'csv', title: t('library.form.fromCsv') },
              ]}
            />
          )}

          {needsScope && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-grade">{t('library.form.classGrade')}</Label>
                <Select
                  value={grade}
                  onValueChange={(v) => {
                    setGrade(v);
                    setChecked(null);
                  }}
                >
                  <SelectTrigger id="tpl-grade">
                    <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        {t('library.classGrade', { grade: formatNumber(g, regionConfig) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-subject">{t('library.form.subject')}</Label>
                <Select
                  value={code}
                  onValueChange={(v) => {
                    setCode(v);
                    setChecked(null);
                  }}
                >
                  <SelectTrigger id="tpl-subject">
                    <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectList.map((s) => (
                      <SelectItem key={s.id} value={s.code}>
                        {subjectName(s, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!isRename && source === 'plan' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-plan">{t('library.form.plan')}</Label>
              <Combobox
                id="tpl-plan"
                aria-label={t('library.form.plan')}
                options={planOptions}
                value={planId}
                onValueChange={setPlanId}
              />
            </div>
          )}

          {!isRename && source === 'csv' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-file">{t('library.form.file')}</Label>
              <Input
                id="tpl-file"
                type="file"
                accept=".csv"
                disabled={!scopeReady}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="link"
                className="self-start"
                onClick={() => downloadCsv('study-plan-sample.csv', [[...STUDY_PLAN_CSV_COLUMNS]])}
              >
                {t('create.sampleCsv')}
              </Button>
              {checked && checked.hard_error_count === 0 && (
                <p role="status" className="text-text-secondary">
                  {t('library.form.readOk', {
                    count: checked.rows_to_create,
                    n: formatNumber(checked.rows_to_create, regionConfig),
                  })}
                </p>
              )}
              {checked && checked.hard_error_count > 0 && (
                <div role="alert" className="space-y-1">
                  <p className="text-destructive">
                    {t('library.form.readErrors', { count: checked.hard_error_count })}
                  </p>
                  <ul className="text-caption text-text-secondary">
                    {checked.errors.slice(0, MAX_ERRORS_SHOWN).map((err, i) => (
                      <li key={i}>
                        {`${t('create.preview.no')} ${formatNumber(err.row, regionConfig)}: ${err.message}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {checked && checked.warnings.length > 0 && (
                <ul className="text-caption text-text-secondary">
                  {checked.warnings.slice(0, MAX_ERRORS_SHOWN).map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('create.errors.generic')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave} loading={saving}>
              {tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
