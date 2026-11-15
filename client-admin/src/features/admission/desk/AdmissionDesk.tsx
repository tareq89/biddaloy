import { NextActionCard, StatusBadge } from '@biddaloy/ui/components';
import {
  useAdmissionApplicants,
  useAdmissionLists,
  useAdmissionRound,
  useAdmissionStages,
  useFeeProofs,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';

import { ApplicantsPanel } from './ApplicantsPanel';
import { DeskStepper, type DeskStep } from './DeskStepper';
import { ListsPanel } from './ListsPanel';
import { LotteryPanel } from './LotteryPanel';
import { nextAction, type DeskStageKind } from './next-action';
import { PublicationPanel } from './PublicationPanel';
import { StagePanel } from './StagePanel';

const ROUTE = '/_staff/admissions/rounds/$roundId' as const;

/** One round's work screen: stepper, one big "what to do now" card, and the step's panel (#2204 D11). */
export function AdmissionDesk() {
  const { t } = useTranslation('admission-desk');
  const region = useRegionConfig();
  const navigate = useNavigate();
  const { roundId } = useParams({ from: ROUTE });
  const { step } = useSearch({ from: ROUTE });

  const round = useAdmissionRound(roundId);
  const stagesQ = useAdmissionStages(roundId);
  const applicants = useAdmissionApplicants({ intakeId: roundId, limit: 1 });
  const fees = useFeeProofs({ intakeId: roundId, state: 'AWAITING', limit: 1 });
  const listsQ = useAdmissionLists(roundId);

  if (round.isError || stagesQ.isError || applicants.isError || fees.isError || listsQ.isError) {
    return (
      <PageContainer>
        <p role="alert">{t('desk.loadError')}</p>
      </PageContainer>
    );
  }
  if (!round.data || !stagesQ.data || !applicants.data || !fees.data || !listsQ.data) {
    return (
      <PageContainer>
        <p role="status">{t('desk.loading')}</p>
      </PageContainer>
    );
  }

  const stages = stagesQ.data
    .filter((s) => s.kind !== 'NONE')
    .sort((a, b) => a.position - b.position);
  const lists = listsQ.data.lists;
  const counts = {
    applicants: applicants.data.total,
    feePending: fees.data.total,
    seatsLeft: listsQ.data.seats_left,
    stages: stages.map((s) => ({
      id: s.id,
      kind: s.kind as DeskStageKind,
      done: s.cutoff_committed_at !== null,
    })),
    lists,
  };
  const action = nextAction(counts, new Date());

  const stepList: DeskStep[] = [
    { id: 'applicants', label: t('desk.steps.applicants') },
    ...stages.map((s) => ({ id: s.id, label: s.title || t(`desk.steps.kind.${s.kind}`) })),
    { id: 'merit', label: t('desk.steps.merit') },
    { id: 'waiting', label: t('desk.steps.waiting') },
    { id: 'admit', label: t('desk.steps.admit') },
  ];
  const selected = stepList.some((s) => s.id === step) ? step! : action.step;
  const select = (id: string) =>
    void navigate({ to: '.', search: (prev: object) => ({ ...prev, step: id }), replace: true });
  const index = stepList.findIndex((s) => s.id === selected);
  const stage = stages.find((s) => s.id === selected);
  const panel = stage ? (
    stage.kind === 'LOTTERY' ? (
      <LotteryPanel />
    ) : (
      <StagePanel />
    )
  ) : selected === 'applicants' ? (
    <ApplicantsPanel />
  ) : selected === 'admit' ? (
    <PublicationPanel />
  ) : (
    <ListsPanel />
  );
  const stageName = stage
    ? stage.title || t(`desk.steps.kind.${stage.kind}`)
    : (stages.find((s) => s.id === action.stageId)?.title ??
      t(`desk.steps.kind.${stages.find((s) => s.id === action.stageId)?.kind ?? 'WRITTEN'}`));
  const open = round.data.status === 'OPEN';

  return (
    <DetailShell
      name={round.data.title}
      statusBadge={
        <StatusBadge
          tone={open ? 'success' : 'neutral'}
          label={open ? t('desk.statusOpen') : t('desk.statusClosed')}
        />
      }
      facts={[
        { label: t('desk.facts.applicants'), value: formatNumber(counts.applicants, region) },
        { label: t('desk.facts.feePending'), value: formatNumber(counts.feePending, region) },
        { label: t('desk.facts.seats'), value: formatNumber(round.data.seat_count, region) },
        { label: t('desk.facts.seatsLeft'), value: formatNumber(counts.seatsLeft, region) },
      ]}
    >
      <div className="flex flex-col gap-4">
        <DeskStepper
          steps={stepList}
          selected={selected}
          next={action.step}
          onSelect={select}
          label={t('desk.stepper.label')}
          pickLabel={t('desk.stepper.pick')}
          progressLabel={t('desk.stepper.progress', {
            current: formatNumber(index + 1, region),
            total: formatNumber(stepList.length, region),
          })}
        />
        <NextActionCard
          title={t(`desk.next.${action.key}.title`, {
            num: formatNumber(action.count ?? 0, region),
            n: formatNumber(action.n ?? 0, region),
          })}
          description={t(`desk.next.${action.key}.description`, { stage: stageName })}
          action={{
            label: t(`desk.next.${action.key}.action`, { n: formatNumber(action.n ?? 0, region) }),
            onClick: () => select(action.step),
          }}
        />
        <div>{panel}</div>
      </div>
    </DetailShell>
  );
}
