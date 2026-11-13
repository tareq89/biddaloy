import { INSTITUTION_KINDS } from '@biddaloy/shared';
import { getActiveTenant } from '@biddaloy/ui/api';
import { Button, Card, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import * as React from 'react';

import { CurriculumPresetForm } from '../../../pages/curriculum-preset/CurriculumPresetPage';
import { usePresetStatus } from '../../../pages/curriculum-preset/use-preset-status';
import { KindCards } from '../../../pages/settings/modules-words/KindCards';
import {
  useApplyKind,
  useInstitutionKinds,
} from '../../../pages/settings/modules-words/use-institution-kinds';

import { StepNav } from './step-nav';

const appliedKeyFor = (schoolId: string | null | undefined) => `welcome-kind-applied:${schoolId}`;
const readApplied = (schoolId: string | null | undefined) => {
  try {
    return sessionStorage.getItem(appliedKeyFor(schoolId));
  } catch {
    return null;
  }
};

/**
 * Step 2: the curriculum preset's own flow. A school that already has classes or
 * students (status CUSTOM — also what a 409 PRESET_NOT_FRESH turns the status into)
 * gets the plain reason and a way to do it by hand instead.
 */
export function CurriculumStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation('onboardingSetup');
  const schoolId = getActiveTenant();
  const status = usePresetStatus();
  const [presetStep, setPresetStep] = React.useState('pick');
  const kinds = useInstitutionKinds();
  const applyKind = useApplyKind();
  const [pickedPack, setPickedPack] = React.useState<string | undefined>();
  // undefined = untouched (follow the pack), null = the admin cleared it.
  const [chosenKind, setChosenKind] = React.useState<string | null | undefined>();
  const [failedKind, setFailedKind] = React.useState<string | null>(null);
  // Kept for the tab session so coming back to this step never applies the same kind again silently.
  const [appliedKind, setAppliedKind] = React.useState(() => readApplied(schoolId));
  const packId = pickedPack ?? status.data?.preset?.id;
  const suggested =
    INSTITUTION_KINDS.find((k) => packId && k.matchesPresetIds.includes(packId))?.id ?? null;
  const kindId = chosenKind !== undefined ? chosenKind : (appliedKind ?? suggested);

  async function next() {
    // A kind that is only suggested by a pack that is not applied yet is not applied by a skip.
    const explicit = chosenKind != null || status.data?.state === 'APPLIED';
    if (kindId && explicit && kindId !== appliedKind && kindId !== failedKind) {
      try {
        await applyKind.mutateAsync(kindId);
        setAppliedKind(kindId);
        try {
          sessionStorage.setItem(appliedKeyFor(schoolId), kindId);
        } catch {
          // storage blocked: the guard just lasts as long as this step stays mounted
        }
      } catch {
        // Rule 25: never retried. The error stays on screen; the next click moves on.
        setFailedKind(kindId);
        return;
      }
    }
    onNext();
  }

  const wizardOpen = !!schoolId && !!status.data && status.data.state === 'AVAILABLE';

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-h2">{t('guided.curriculum.title')}</h2>
      <p className="text-text-secondary">{t('guided.curriculum.hint')}</p>
      {status.data?.state === 'CUSTOM' ? (
        <Card padded role="status" className="flex items-start gap-3">
          <Info aria-hidden className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-2">
            <p>{t('guided.curriculum.blocked')}</p>
            <Link to="/classes" className="font-medium underline">
              {t('guided.curriculum.byHand')}
            </Link>
          </div>
        </Card>
      ) : !status.data && !status.isError ? (
        <Skeleton aria-busy="true" className="h-44 w-full" />
      ) : schoolId ? (
        <CurriculumPresetForm
          embedded
          schoolId={schoolId}
          stepId={presetStep}
          onStepChange={setPresetStep}
          onPickChange={setPickedPack}
        />
      ) : null}
      <KindCards
        kinds={kinds.data}
        loading={kinds.isPending}
        error={kinds.isError}
        onRetry={() => void kinds.refetch()}
        selectedId={kindId ?? undefined}
        onSelect={(id) => setChosenKind(id === kindId ? null : id)}
        title={t('guided.curriculum.kind.title')}
        intro={t('guided.curriculum.kind.intro')}
      />
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={!kindId}
        onClick={() => setChosenKind(null)}
      >
        {t('guided.curriculum.kind.skip')}
      </Button>
      {failedKind && failedKind === kindId && (
        <p role="alert" className="text-sm text-destructive">
          {t('guided.curriculum.kind.applyError')}{' '}
          <Link
            to="/settings"
            search={{ section: 'modulesWords' }}
            className="font-medium underline"
          >
            {t('guided.curriculum.kind.applyErrorLink')}
          </Link>
        </p>
      )}
      {/* The preset flow has its own Next / Apply: ours stays a quiet skip until it is applied. */}
      {wizardOpen ? (
        <StepNav
          onBack={onBack}
          onPrimary={() => void next()}
          busy={applyKind.isPending}
          quiet
          primaryLabel={t('guided.curriculum.skip')}
        />
      ) : (
        <StepNav onBack={onBack} onPrimary={() => void next()} busy={applyKind.isPending} />
      )}
    </div>
  );
}
