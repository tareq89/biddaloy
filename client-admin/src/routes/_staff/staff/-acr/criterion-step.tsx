/**
 * [28.3.2] Step 2 of the ACR form: the criteria, scored 4/3/2/1.
 *
 * Desktop shows every criterion in two blocks; the active one is marked
 * and pressing 4/3/2/1 (handled by `AcrForm`'s document listener) scores
 * and advances it. Phone (D23) shows ONE criterion at a time, with four
 * large buttons — the non-active rows and block headings are `hidden`
 * below `md`, so they leave the tab order too.
 */
import { Button } from '@biddaloy/ui/components';
import type { AcrCriterion } from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';

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
  const active = criteria[activeIndex];
  const blocks = [
    { block: 'BLOCK_2' as const, title: t('acr.step2.block2') },
    { block: 'BLOCK_3' as const, title: t('acr.step2.block3') },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && (
        <p className="text-sm text-muted-foreground" id="acr-keyboard-hint">
          {t('acr.keyboardHint')}
        </p>
      )}
      <p className="text-sm font-medium md:hidden" aria-live="polite">
        {t('acr.criterionOf', { current: activeIndex + 1, total: criteria.length })}
      </p>
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
            className={`${holdsActive ? '' : 'hidden md:block'} flex flex-col gap-3`}
          >
            <h3 id={`acr-${block}`} className="text-base font-semibold">
              {title}
            </h3>
            <ul className="flex flex-col gap-3">
              {inBlock.map(({ criterion, index }) => {
                const isActive = index === activeIndex;
                const score = scores[criterion.id];
                const label = locale === 'bn' ? criterion.label_bn : criterion.label_en;
                return (
                  <li
                    key={criterion.id}
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive}
                    className={`${isActive ? '' : 'hidden md:flex'} flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:justify-between ${
                      isActive ? 'border-primary' : 'border-border-subtle'
                    }`}
                  >
                    <span id={`acr-c-${criterion.id}`} className="text-sm font-medium">
                      {label}
                      {score === undefined && (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          {t('acr.step2.unscored')}
                        </span>
                      )}
                    </span>
                    <div
                      role="group"
                      aria-labelledby={`acr-c-${criterion.id}`}
                      className="grid grid-cols-2 gap-2 md:flex"
                    >
                      {SCORE_VALUES.map((value) => (
                        <Button
                          key={value}
                          type="button"
                          variant={score === value ? 'default' : 'outline'}
                          aria-pressed={score === value}
                          disabled={readOnly}
                          onFocus={() => onActiveChange(index)}
                          onClick={() => onScore(index, value)}
                          className="h-14 text-base md:h-(--control-h,2rem) md:text-sm"
                        >
                          {value} · {t(`acr.scores.${value}`)}
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
          {t('acr.back')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={activeIndex >= criteria.length - 1}
          onClick={() => onActiveChange(activeIndex + 1)}
        >
          {t('acr.next')}
        </Button>
      </div>
    </div>
  );
}
