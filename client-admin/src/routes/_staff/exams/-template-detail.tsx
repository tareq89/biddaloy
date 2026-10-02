/**
 * [35.4.5] Exam template detail — `DetailShell` with one "Components" tab:
 * an inline rename field above the component grid. No route here
 * ([35.4.9]); the route passes the id. The `PresetWarningBanner` is mounted
 * by [35.4.6], not here.
 */
import { Button, Input } from '@biddaloy/ui/components';
import { useAllSubjects } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import * as React from 'react';

import { NAME_MAX, TemplateGrid } from './-template-grid';
import { useExamTemplate, useUpdateExamTemplate } from './use-exam-templates';

export interface TemplateDetailProps {
  templateId: string;
}

export function TemplateDetail({ templateId }: TemplateDetailProps) {
  const { t } = useTranslation('examTemplates');
  const query = useExamTemplate(templateId);
  const subjectsQuery = useAllSubjects();
  const update = useUpdateExamTemplate(templateId);
  const [name, setName] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('components');

  const saved = query.data?.name;
  React.useEffect(() => {
    if (saved !== undefined) setName(saved);
  }, [saved]);

  const subjects = React.useMemo(
    () => (subjectsQuery.data ?? []).map((s) => ({ code: s.code, name: s.name_en })),
    [subjectsQuery.data],
  );

  if (query.isLoading) return <p role="status">{t('detail.loading')}</p>;
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('detail.loadError')}
      </p>
    );
  }
  const template = query.data;

  function rename(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNameError(t('form.errorNameRequired'));
    if (trimmed.length > NAME_MAX)
      return setNameError(t('form.errorNameTooLong', { max: NAME_MAX }));
    setNameError(null);
    update.mutate({ name: trimmed });
  }

  const errorText = (e: unknown) => (e instanceof Error ? e.message : t('detail.saveError'));

  return (
    <DetailShell
      name={template.name}
      identifiers={t(`kind.${template.kind}`, { ns: 'exams' })}
      tabs={[
        {
          id: 'components',
          label: t('detail.tabComponents'),
          content: (
            <div className="flex flex-col gap-6">
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="template-detail-name" className="text-sm font-medium">
                    {t('detail.nameLabel')}
                  </label>
                  <Input
                    id="template-detail-name"
                    className="w-72"
                    value={name}
                    aria-invalid={nameError !== null}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  loading={update.isPending && update.variables?.rows === undefined}
                  disabled={name.trim() === template.name}
                >
                  {t('detail.rename')}
                </Button>
                {(nameError || (update.isError && update.variables?.name !== undefined)) && (
                  <p role="alert" className="w-full text-xs text-destructive">
                    {nameError ?? errorText(update.error)}
                  </p>
                )}
              </form>
              <TemplateGrid
                rows={template.rows}
                subjects={subjects}
                saving={update.isPending && update.variables?.rows !== undefined}
                error={
                  update.isError && update.variables?.rows !== undefined
                    ? errorText(update.error)
                    : null
                }
                onSave={(rows) => update.mutate({ rows })}
              />
            </div>
          ),
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}
