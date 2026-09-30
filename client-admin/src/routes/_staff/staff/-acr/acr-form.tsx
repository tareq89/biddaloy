/**
 * [28.3.2] The ACR form: a 3-step `WizardShell` (period · criteria ·
 * closing remarks), autosaved through `useAcrAutosave` (28.3.1).
 *
 * Form fields are LOCAL state seeded once from `assessment` — never bound
 * to the query cache. `useUpdateAcr` writes each PATCH response into the
 * detail cache, and a slow response must not overwrite what the admin has
 * typed since. The server answer is only adopted on complete/reopen, when
 * the caller swaps `assessment` (and `key`s this component) with the
 * mutation result.
 *
 * Keyboard (D21): 4/3/2/1 score the active criterion and advance (only
 * outside text fields); Ctrl+Enter completes once every criterion is
 * scored. A completed ACR renders read-only, stacked, with Reopen.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcrAutosave,
  useCompleteAcr,
  useHasPermission,
  useReopenAcr,
  type AcrAssessment,
  type AcrCriterion,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { WizardShell } from '@biddaloy/ui/shells';
import * as React from 'react';

import { CriterionStep, SCORE_VALUES, type ScoreValue } from './criterion-step';

interface Step1 {
  period_from: string;
  period_to: string;
  employment_duration: string;
  description: string;
}
interface Step3 {
  special_qualification: string;
  honesty_reputation: string;
  promotion_eligible: '' | 'yes' | 'no';
  training: string;
  recommendations: string;
}

function str(data: Record<string, unknown> | null, key: string): string {
  const v = data?.[key];
  return typeof v === 'string' ? v : '';
}

function seedStep1(data: Record<string, unknown> | null): Step1 {
  return {
    period_from: str(data, 'period_from'),
    period_to: str(data, 'period_to'),
    employment_duration: str(data, 'employment_duration'),
    description: str(data, 'description'),
  };
}

function seedStep3(data: Record<string, unknown> | null): Step3 {
  const eligible = str(data, 'promotion_eligible');
  return {
    special_qualification: str(data, 'special_qualification'),
    honesty_reputation: str(data, 'honesty_reputation'),
    promotion_eligible: eligible === 'yes' || eligible === 'no' ? eligible : '',
    training: str(data, 'training'),
    recommendations: str(data, 'recommendations'),
  };
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export interface AcrFormProps {
  assessment: AcrAssessment;
  criteria: readonly AcrCriterion[];
  /** Fired with the server's answer after Complete / Reopen succeed. */
  onServerUpdate: (assessment: AcrAssessment) => void;
}

export function AcrForm({ assessment, criteria, onServerUpdate }: AcrFormProps) {
  const { t } = useTranslation('evaluations');
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const completed = assessment.status === 'COMPLETED';
  const readOnly = completed || !canWrite;

  const ordered = React.useMemo(
    () =>
      [...criteria].sort((a, b) => a.block.localeCompare(b.block) || a.sort_order - b.sort_order),
    [criteria],
  );

  const [step1, setStep1] = React.useState(() => seedStep1(assessment.step1_data));
  const [step3, setStep3] = React.useState(() => seedStep3(assessment.step3_data));
  const [scores, setScores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(assessment.scores.map((s) => [s.criterion_id, s.score])),
  );
  const [stepId, setStepId] = React.useState('period');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const autosave = useAcrAutosave(assessment.id);
  const complete = useCompleteAcr();
  const reopen = useReopenAcr();

  const allScored = ordered.length > 0 && ordered.every((c) => scores[c.id] !== undefined);

  function patchStep1(patch: Partial<Step1>) {
    const next = { ...step1, ...patch };
    setStep1(next);
    autosave.stageStep1({ ...next });
  }
  function patchStep3(patch: Partial<Step3>) {
    const next = { ...step3, ...patch };
    setStep3(next);
    autosave.stageStep3({ ...next });
  }
  const score = React.useCallback(
    (index: number, value: ScoreValue) => {
      const criterion = ordered[index];
      if (!criterion || readOnly) return;
      setScores((prev) => ({ ...prev, [criterion.id]: value }));
      autosave.stageScore(criterion.id, value);
      setActiveIndex(Math.min(index + 1, ordered.length - 1));
    },
    [ordered, readOnly, autosave],
  );

  const submit = React.useCallback(async () => {
    if (readOnly || complete.isPending) return;
    if (!allScored) {
      toast.error(t('acr.submitBlocked'));
      return;
    }
    // `flush` resolves false when a save failed — never complete on that.
    if (!(await autosave.flush())) {
      toast.error(t('acr.completeError'));
      return;
    }
    try {
      onServerUpdate(await complete.mutateAsync(assessment.id));
    } catch {
      toast.error(t('acr.completeError'));
    }
  }, [readOnly, complete, allScored, autosave, assessment.id, onServerUpdate, t]);

  // Latest handlers for the one document listener, so it is bound once.
  const live = React.useRef({ score, submit, activeIndex, stepId });
  live.current = { score, submit, activeIndex, stepId };
  React.useEffect(() => {
    if (readOnly) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void live.current.submit();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTextTarget(e.target)) return;
      const value = Number(e.key);
      if (
        live.current.stepId === 'criteria' &&
        (SCORE_VALUES as readonly number[]).includes(value)
      ) {
        e.preventDefault();
        live.current.score(live.current.activeIndex, value as ScoreValue);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [readOnly]);

  async function handleReopen() {
    try {
      onServerUpdate(await reopen.mutateAsync(assessment.id));
    } catch {
      toast.error(t('acr.reopenError'));
    }
  }

  const step1Content = (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('acr.step1.periodFrom')}
        type="date"
        value={step1.period_from}
        disabled={readOnly}
        onChange={(v) => patchStep1({ period_from: v })}
      />
      <TextField
        label={t('acr.step1.periodTo')}
        type="date"
        value={step1.period_to}
        disabled={readOnly}
        onChange={(v) => patchStep1({ period_to: v })}
      />
      <TextField
        label={t('acr.step1.employmentDuration')}
        value={step1.employment_duration}
        disabled={readOnly}
        onChange={(v) => patchStep1({ employment_duration: v })}
      />
      <AreaField
        label={t('acr.step1.description')}
        value={step1.description}
        disabled={readOnly}
        onChange={(v) => patchStep1({ description: v })}
      />
    </div>
  );

  const step2Content = (
    <CriterionStep
      criteria={ordered}
      scores={scores}
      activeIndex={activeIndex}
      onActiveChange={setActiveIndex}
      onScore={score}
      readOnly={readOnly}
    />
  );

  const eligibleId = React.useId();
  const step3Content = (
    <div className="flex flex-col gap-4">
      <AreaField
        label={t('acr.step3.specialQualification')}
        value={step3.special_qualification}
        disabled={readOnly}
        onChange={(v) => patchStep3({ special_qualification: v })}
      />
      <AreaField
        label={t('acr.step3.honestyReputation')}
        value={step3.honesty_reputation}
        disabled={readOnly}
        onChange={(v) => patchStep3({ honesty_reputation: v })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend id={eligibleId} className="text-sm font-medium">
          {t('acr.step3.promotionEligibility')}
        </legend>
        <RadioGroup
          aria-labelledby={eligibleId}
          value={step3.promotion_eligible}
          disabled={readOnly}
          onValueChange={(v) => patchStep3({ promotion_eligible: v === 'yes' ? 'yes' : 'no' })}
          className="flex gap-4"
        >
          {(['yes', 'no'] as const).map((v) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem id={`${eligibleId}-${v}`} value={v} />
              <Label htmlFor={`${eligibleId}-${v}`}>
                {t(v === 'yes' ? 'acr.step3.promotionYes' : 'acr.step3.promotionNo')}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <AreaField
        label={t('acr.step3.training')}
        value={step3.training}
        disabled={readOnly}
        onChange={(v) => patchStep3({ training: v })}
      />
      <AreaField
        label={t('acr.step3.recommendations')}
        value={step3.recommendations}
        disabled={readOnly}
        onChange={(v) => patchStep3({ recommendations: v })}
      />
      {!readOnly && <p className="text-sm text-muted-foreground">{t('acr.submitHint')}</p>}
    </div>
  );

  if (completed) {
    const sections = [
      { id: 'period', content: step1Content },
      { id: 'criteria', content: step2Content },
      { id: 'closing', content: step3Content },
    ];
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">{t('acr.title')}</h1>
        <div role="status" className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('acr.completedReadOnly')}</p>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              loading={reopen.isPending}
              onClick={() => void handleReopen()}
            >
              {t('acr.reopen')}
            </Button>
          )}
        </div>
        <p className="text-base font-semibold">
          {t('acr.total')}: {assessment.total ?? '—'}
        </p>
        {sections.map(({ id, content }) => (
          <section key={id} aria-labelledby={`acr-s-${id}`} className="flex flex-col gap-3">
            <h2 id={`acr-s-${id}`} className="text-lg font-semibold">
              {t(`acr.steps.${id}`)}
            </h2>
            {content}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-end text-xs text-muted-foreground"
      >
        {autosave.state === 'idle' ? '' : t(`acr.save.${autosave.state}`)}
      </p>
      <WizardShell
        title={t('acr.title')}
        currentStepId={stepId}
        onStepChange={setStepId}
        onSubmit={() => void submit()}
        submitLabel={t('acr.submit')}
        submitting={complete.isPending}
        steps={[
          { id: 'period', label: t('acr.steps.period'), content: step1Content },
          {
            id: 'criteria',
            label: t('acr.steps.criteria'),
            content: step2Content,
            isValid: () => allScored,
          },
          {
            id: 'closing',
            label: t('acr.steps.closing'),
            content: step3Content,
            isValid: () => allScored && canWrite,
          },
        ]}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AreaField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
