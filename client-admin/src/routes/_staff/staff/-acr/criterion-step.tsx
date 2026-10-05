/**
 * [28.3.2] Step 2 of the ACR form: the criteria, scored 4/3/2/1.
 *
 * Desktop shows every criterion in two blocks; the active one is marked
 * and pressing 4/3/2/1 (handled by `AcrForm`'s document listener) scores
 * and advances it. Phone (D23) shows ONE criterion at a time, with four
 * large buttons — the non-active rows and block headings are `hidden`
 * below `md`, so they leave the tab order too.
 */
import { Button, StatusBadge } from '@biddaloy/ui/components';
import type { AcrCriterion } from '@biddaloy/ui/hooks';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

export const SCORE_VALUES = [4, 3, 2, 1] as const;
export type ScoreValue = (typeof SCORE_VALUES)[number];

export interface CriterionStepProps {
  /** Already ordered: block 2 then block 3, by `sort_order`. */
  criteria: readonly AcrCriterion[];
  scores: Readonly<Record<string, number>>;
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onScore: (index: number, score: ScoreValue) => void;
  readOnly: boolean;
}

export function CriterionStep({
  criteria,
  scores,
  activeIndex,
  onActiveChange,
  onScore,
  readOnly,
}: CriterionStepProps) {
  const { t } = useTranslation('evaluations');
  const { locale } = useLocale();
  const cfg = useTenantRegionConfig();
  const scored = criteria.filter((c) => scores[c.id] !== undefined).length;
  const active = criteria[activeIndex];
  const blocks = [
    { block: 'BLOCK_2' as const, title: t('acr.step2.block2') },
    { block: 'BLOCK_3' as const, title: t('acr.step2.block3') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="font-medium" aria-live="polite">
          <span className="md:hidden">
            {t('acr.criterionOf', {
              current: formatNumber(activeIndex + 1, cfg),
              total: formatNumber(criteria.length, cfg),
            })}{' '}
            ·{' '}
          </span>
          {t('acr.scoredOf', {
            scored: formatNumber(scored, cfg),
            total: formatNumber(criteria.length, cfg),
          })}
        </p>
        {!readOnly && (
          <p className="hidden text-text-secondary md:block" id="acr-keyboard-hint">
            {t('acr.keyboardHint')}
          </p>
        )}
      </div>
      {blocks.map(({ block, title }) => {
        const inBlock = criteria
          .map((criterion, index) => ({ criterion, index }))
          .filter(({ criterion }) => criterion.block === block);
        if (inBlock.length === 0) return null;
        const holdsActive = active?.block === block;
        return (
          <section
            key={block}
            aria-labelledby={`acr-${block}`}
            className={`${holdsActive ? '' : 'hidden md:block'} rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`}
          >
            <h2 id={`acr-${block}`} className="text-h2">
              {title}
            </h2>
            <ul className="mt-2">
              {inBlock.map(({ criterion, index }, position) => {
                const isActive = index === activeIndex;
                const score = scores[criterion.id];
                const label = locale === 'bn' ? criterion.label_bn : criterion.label_en;
                return (
                  <li
                    key={criterion.id}
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive}
                    className={`${isActive ? '' : 'hidden md:flex'} flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-4 ${
                      position < inBlock.length - 1 ? 'md:border-b md:border-border-subtle' : ''
                    }`}
                  >
                    <span
                      id={`acr-c-${criterion.id}`}
                      className={`flex min-w-0 flex-wrap items-center gap-2 border-s-2 ps-3 font-medium ${
                        isActive ? 'border-primary' : 'border-transparent'
                      }`}
                    >
                      {label}
                      {score === undefined && (
                        <StatusBadge tone="neutral" label={t('acr.step2.unscored')} />
                      )}
                    </span>
                    <div
                      role="group"
                      aria-labelledby={`acr-c-${criterion.id}`}
                      className="grid shrink-0 grid-cols-2 gap-2 md:flex md:gap-1"
                    >
                      {SCORE_VALUES.map((value) => (
                        <Button
                          key={value}
                          type="button"
                          variant="outline"
                          aria-pressed={score === value}
                          disabled={readOnly}
                          onFocus={() => onActiveChange(index)}
                          onClick={() => onScore(index, value)}
                          className={`h-14 md:h-8 md:px-2.5 ${
                            score === value
                              ? 'border-primary bg-secondary font-semibold text-secondary-foreground'
                              : ''
                          }`}
                        >
                          {score === value && <CheckIcon className="size-4" aria-hidden="true" />}
                          {formatNumber(value, cfg)} · {t(`acr.scores.${value}`)}
                        </Button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="flex justify-between gap-2 md:hidden">
        <Button
          type="button"
          variant="outline"
          disabled={activeIndex === 0}
          onClick={() => onActiveChange(activeIndex - 1)}
        >
          <ChevronLeftIcon aria-hidden="true" />
          {t('acr.prevCriterion')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={activeIndex >= criteria.length - 1}
          onClick={() => onActiveChange(activeIndex + 1)}
        >
          {t('acr.nextCriterion')}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
