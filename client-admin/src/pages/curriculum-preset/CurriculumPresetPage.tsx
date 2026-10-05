/**
 * [35.4.3] The Curriculum preset screen (route comes in #1289). Reads the
 * school's preset status (D26): AVAILABLE -> 3-step wizard, APPLIED ->
 * summary, CUSTOM -> read-only message + what blocks it (never an apply button).
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useWizardShellStep, WizardShell } from '@biddaloy/ui/shells';
import { Info } from 'lucide-react';
import * as React from 'react';

import { AppliedSummary } from './AppliedSummary';
import { ApplyOptionsForm, isApplyOptionsValid, type ApplyOptions } from './ApplyOptionsForm';
import { BlockedState } from './BlockedState';
import { ConfirmApplyDialog } from './ConfirmApplyDialog';
import { PresetCards } from './PresetCards';
import { PresetPreviewSheet } from './PresetPreviewSheet';
import { usePresetStatus } from './use-preset-status';
import { useApplyPreset, usePickText, usePresetList, type ApplyPresetResult } from './use-presets';

const STEP_IDS = ['pick', 'options', 'review'] as const;

export interface CurriculumPresetPageProps {
  schoolId: string;
}

function CardsSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-44 w-full" />
      ))}
    </div>
  );
}

export function CurriculumPresetPage({ schoolId }: CurriculumPresetPageProps) {
  const { t } = useTranslation('curriculumPreset');
  const pick = usePickText();
  const status = usePresetStatus();
  const list = usePresetList();
  const apply = useApplyPreset(schoolId);
  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [options, setOptions] = React.useState<ApplyOptions>({
    stages: [],
    versions: [],
    startYear: String(new Date().getFullYear()),
  });
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  // The preview opens from state, not a Radix trigger, so remember who opened it and give focus back on close.
  const previewOpenerRef = React.useRef<HTMLElement | null>(null);
  const openPreview = (id: string) => {
    previewOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreviewId(id);
  };
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [result, setResult] = React.useState<ApplyPresetResult | null>(null);

  const selected = list.data?.find((p) => p.id === selectedId) ?? null;

  function handleSelect(id: string) {
    if (id === selectedId) return;
    const preset = list.data?.find((p) => p.id === id);
    setSelectedId(id);
    // Every stage on by default; versions start empty so the admin chooses.
    setOptions((prev) => ({
      ...prev,
      stages: preset?.stages.map((s) => s.key) ?? [],
      versions: [],
    }));
  }

  function handleConfirm() {
    if (!selected) return;
    apply.mutate(
      {
        preset_id: selected.id,
        start_year: Number(options.startYear),
        stages: options.stages,
        ...(selected.versions?.length ? { versions: options.versions } : {}),
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setConfirmOpen(false);
        },
        // 409 PRESET_NOT_FRESH: status is re-fetched (hook's onSettled) and
        // turns CUSTOM, which renders BlockedState — nothing to show here.
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) setConfirmOpen(false);
        },
      },
    );
  }

  const title = t('title');
  // Every non-wizard state sits in the same frame so the title never disappears.
  const framed = (body: React.ReactNode) => (
    <PageContainer size="narrow">
      <PageHeader title={title} subtitle={t('subtitle')} />
      {body}
    </PageContainer>
  );

  if (status.isError || list.isError) {
    return framed(
      <ErrorState
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => {
          void status.refetch();
          void list.refetch();
        }}
      />,
    );
  }
  if (!status.data || (result && status.data.state !== 'APPLIED' && status.isFetching)) {
    return framed(<CardsSkeleton />);
  }

  const { state, preset, blockers } = status.data;

  if (state === 'APPLIED' && preset) {
    const presetEntry = list.data?.find((p) => p.id === preset.id);
    return framed(
      <AppliedSummary
        preset={preset}
        presetName={presetEntry ? pick(presetEntry.name) : undefined}
        created={result?.created}
      />,
    );
  }

  if (state === 'CUSTOM') {
    return framed(
      <>
        <Card padded role="status" className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-partial-bg text-status-partial-fg">
            <Info aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-h2">{t('custom.title')}</h2>
            <p className="mt-1 text-text-secondary">{t('custom.message')}</p>
          </div>
        </Card>
        <BlockedState blockers={blockers ?? []} />
      </>,
    );
  }

  if (!list.data) return framed(<CardsSkeleton />);

  const optionsValid = selected ? isApplyOptionsValid(selected, options) : false;

  return (
    <>
      <WizardShell
        title={title}
        currentStepId={stepId}
        onStepChange={setStepId}
        steps={[
          {
            id: 'pick',
            label: t('steps.pick'),
            isValid: () => selected !== null,
            content: (
              <PresetCards
                presets={list.data}
                selectedId={selectedId}
                onSelect={handleSelect}
                onPreview={openPreview}
              />
            ),
          },
          {
            id: 'options',
            label: t('steps.options'),
            isValid: () => optionsValid,
            content: selected && (
              <ApplyOptionsForm summary={selected} value={options} onChange={setOptions} />
            ),
          },
        ]}
        irreversible
        reviewStep={{
          id: 'review',
          label: t('steps.confirm'),
          content: selected && (
            <div className="flex flex-col gap-2">
              <p>
                {t('review.summary', {
                  name: pick(selected.name),
                  stages: selected.stages
                    .filter((s) => options.stages.includes(s.key))
                    .map((s) => pick(s.name))
                    .join(', '),
                  year: options.startYear,
                })}
              </p>
              {selected.versions && options.versions.length > 0 && (
                <p>
                  {t('review.versions', {
                    names: selected.versions
                      .filter((v) => options.versions.includes(v.key))
                      .map((v) => pick(v.name))
                      .join(', '),
                  })}
                </p>
              )}
              {!selected.verified && (
                <p role="note" className="rounded-lg bg-status-due-bg p-3 text-status-due-fg">
                  {t('unverifiedWarning')}
                </p>
              )}
              <p className="text-text-secondary">{t('review.next')}</p>
            </div>
          ),
        }}
        submitLabel={t('submit')}
        onSubmit={() => {
          apply.reset();
          setConfirmOpen(true);
        }}
      />
      <PresetPreviewSheet
        presetId={previewId}
        onClose={() => setPreviewId(null)}
        returnFocusTo={previewOpenerRef}
      />
      <ConfirmApplyDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        presetName={selected?.name.en ?? ''}
        onConfirm={handleConfirm}
        pending={apply.isPending}
        error={apply.isError}
      />
    </>
  );
}
