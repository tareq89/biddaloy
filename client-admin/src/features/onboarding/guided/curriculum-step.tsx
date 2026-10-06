import { getActiveTenant } from '@biddaloy/ui/api';
import { Card, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import * as React from 'react';

import { CurriculumPresetForm } from '../../../pages/curriculum-preset/CurriculumPresetPage';
import { usePresetStatus } from '../../../pages/curriculum-preset/use-preset-status';

import { StepNav } from './step-nav';

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
        />
      ) : null}
      <StepNav onBack={onBack} onPrimary={onNext} />
    </div>
  );
}
