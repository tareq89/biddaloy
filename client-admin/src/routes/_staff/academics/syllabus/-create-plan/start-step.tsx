/** Step 2: where the lessons come from — empty, a library template, or a CSV file (D4) — and the D27 carry-over tick. */
import { STUDY_PLAN_CSV_COLUMNS } from '@biddaloy/shared';
import {
  BulkUploadPreview,
  Button,
  Card,
  Checkbox,
  ChoiceCards,
  NoticeBar,
  RadioRows,
  type BulkUploadPreviewController,
} from '@biddaloy/ui/components';
import {
  useStudyPlanTemplates,
  useValidateStudyPlanImport,
  type StudyPlanImportSummary,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { downloadCsv, formatDate, formatNumber } from '@biddaloy/ui/utils';
import { DownloadIcon, FileSpreadsheetIcon, LibraryIcon, SquarePenIcon } from 'lucide-react';
import * as React from 'react';

export type StartSource = 'empty' | 'library' | 'csv';
export type CsvController = BulkUploadPreviewController<StudyPlanImportSummary, unknown>;

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface CarryOver {
  termName: string;
  count: number;
}

export interface CapacityLine {
  term: string;
  available: number;
  needed: number;
}

export function CapacityNotice({ line }: { line: CapacityLine }) {
  const { t } = useTranslation('studyPlans');
  const regionConfig = useTenantRegionConfig();
  return (
    <NoticeBar tone={line.needed > line.available ? 'warning' : 'info'}>
      {t('create.capacity', {
        term: line.term,
        available: formatNumber(line.available, regionConfig),
        needed: formatNumber(line.needed, regionConfig),
      })}
    </NoticeBar>
  );
}

export function StartStep({
  summary,
  onChangeScope,
  classId,
  subjectId,
  classGrade,
  subjectCode,
  classLabel,
  subjectLabel,
  source,
  onSource,
  templateId,
  onTemplate,
  preselectTemplate,
  carry,
  carryOn,
  onCarryOn,
  onController,
  capacity,
}: {
  summary: string;
  onChangeScope: () => void;
  classId: string;
  subjectId: string;
  classGrade: number | null;
  subjectCode: string | undefined;
  classLabel: string;
  subjectLabel: string;
  source: StartSource;
  onSource: (next: StartSource) => void;
  templateId: string;
  onTemplate: (id: string) => void;
  preselectTemplate: string | undefined;
  carry: CarryOver | null;
  carryOn: boolean;
  onCarryOn: (next: boolean) => void;
  onController: (controller: CsvController) => void;
  capacity: CapacityLine | null;
}) {
  const { t } = useTranslation('studyPlans');
  const regionConfig = useTenantRegionConfig();
  const validateMutation = useValidateStudyPlanImport();
  const { mutateAsync: validateAsync } = validateMutation;

  const templates = useStudyPlanTemplates({
    ...(classGrade !== null ? { class_grade: classGrade } : {}),
    ...(subjectCode ? { subject_code: subjectCode } : {}),
  });
  const list = templates.data?.data ?? [];

  // `?template=` opens this step on that library choice.
  React.useEffect(() => {
    if (!preselectTemplate || templateId || !list.some((x) => x.id === preselectTemplate)) return;
    onSource('library');
    onTemplate(preselectTemplate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list first has it
  }, [preselectTemplate, list.length]);

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, target: { class_id: classId, subject_id: subjectId }, onProgress }),
    [validateAsync, classId, subjectId],
  );

  return (
    <div className="space-y-6">
      <Card className="flex items-center justify-between gap-3 p-4">
        <p>
          <span className="text-text-secondary">{t('create.scopeSummary')} </span>
          <span className="font-medium">{summary}</span>
        </p>
        <Button type="button" variant="link" onClick={onChangeScope}>
          {t('create.change')}
        </Button>
      </Card>

      {carry && (
        <Card className="space-y-2 p-4">
          <h2 className="text-h3">{t('create.carryOver.title', { count: carry.count })}</h2>
          <p className="text-text-secondary">
            {t('create.carryOver.body', { term: carry.termName })}
          </p>
          <label className="flex items-center gap-2">
            <Checkbox checked={carryOn} onCheckedChange={(v) => onCarryOn(v === true)} />
            {t('create.carryOver.confirm', { count: carry.count })}
          </label>
        </Card>
      )}

      <section className="space-y-3">
        <h2 id="plan-source" className="text-h3">
          {t('create.source.title')}
        </h2>
        <ChoiceCards
          labelledBy="plan-source"
          value={source}
          onValueChange={(v) => onSource(v as StartSource)}
          options={[
            {
              value: 'empty',
              title: t('create.source.empty'),
              description: t('create.source.emptyHelp'),
              icon: SquarePenIcon,
            },
            {
              value: 'library',
              title: t('create.source.library'),
              description: t('create.source.libraryHelp'),
              icon: LibraryIcon,
            },
            {
              value: 'csv',
              title: t('create.source.csv'),
              description: t('create.source.csvHelp'),
              icon: FileSpreadsheetIcon,
            },
          ]}
        />
      </section>

      {source === 'library' && (
        <section className="space-y-3">
          {list.length === 0 ? (
            <p className="text-text-secondary">
              {t('create.noTemplates')}{' '}
              {/* ponytail: plain link; the Template library tab (3-05) is not in the route schema yet. */}
              <a className="text-primary underline" href="/academics/syllabus?tab=library">
                {t('create.openLibrary')}
              </a>
            </p>
          ) : (
            <RadioRows
              legend={t('create.templatesFor', {
                count: list.length,
                class: classLabel,
                subject: subjectLabel,
              })}
              value={templateId}
              onValueChange={onTemplate}
              options={list.map((x) => ({
                value: x.id,
                title: x.name,
                caption: t('create.templateMeta', {
                  lessons: formatNumber(x.lesson_count, regionConfig),
                  periods: formatNumber(x.total_periods, regionConfig),
                  date: formatDate(x.updated_at, regionConfig),
                }),
              }))}
            />
          )}
          {capacity && <CapacityNotice line={capacity} />}
        </section>
      )}

      {source === 'csv' && (
        <section className="space-y-3">
          <BulkUploadPreview<StudyPlanImportSummary, unknown>
            accept=".csv"
            maxFileSize={MAX_FILE_SIZE}
            validate={validate}
            commit={() => Promise.reject(new Error('commit happens on Save'))}
            hideConfirm
            onControllerChange={onController}
            renderSummary={(result) =>
              result.summary.warnings.length > 0 ? (
                <ul className="space-y-1 text-caption text-text-secondary">
                  {result.summary.warnings.map((w, i) => (
                    <li
                      key={i}
                    >{`${t('create.preview.no')} ${formatNumber(w.row, regionConfig)}: ${w.message}`}</li>
                  ))}
                </ul>
              ) : null
            }
            renderDone={() => null}
          />
          <Button
            type="button"
            variant="link"
            onClick={() => downloadCsv('study-plan-sample.csv', [[...STUDY_PLAN_CSV_COLUMNS]])}
          >
            <DownloadIcon aria-hidden="true" />
            {t('create.sampleCsv')}
          </Button>
        </section>
      )}
    </div>
  );
}
