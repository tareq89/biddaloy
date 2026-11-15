/**
 * [71.4.05] The desk's applicants step: "Check fees (N)" chip with its queue, a "New application"
 * link, and the round's applicant list. Filters live in `ApplicantList` (status, fee, quota, source, search).
 */
import { Button, NextActionCard } from '@biddaloy/ui/components';
import {
  useAdmissionApplicants,
  useAdmissionRound,
  useAdmissionStages,
  useFeeProofs,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import * as React from 'react';

import { ApplicantList } from '../ApplicantList';

import { FeeVerifyDialog, type FeeProofRow } from './FeeVerifyDialog';

const QUEUE_PAGE = 10;

export function ApplicantsPanel() {
  const { t } = useTranslation('admission-desk');
  const region = useRegionConfig();
  const { roundId = '' } = useParams({ strict: false });
  const navigate = useNavigate();
  const round = useAdmissionRound(roundId);
  const stages = useAdmissionStages(roundId);
  // ponytail: first 100 only (server cap); a round with more unrolled applicants still shows the card.
  const roster = useAdmissionApplicants({ intakeId: roundId, sort: 'roll', limit: 100 });
  const testStage = (stages.data ?? []).find((s) => s.kind !== 'NONE' && s.kind !== 'FIRST_COME');
  const unrolled = (roster.data?.data ?? []).filter(
    (a) => a.roll_number === null && a.status !== 'FEE_PENDING' && a.status !== 'REJECTED',
  ).length;
  const count = useFeeProofs({ intakeId: roundId, state: 'AWAITING', limit: 1 });
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<FeeProofRow | null>(null);
  const queue = useFeeProofs(
    { intakeId: roundId, state: 'AWAITING', page, limit: QUEUE_PAGE },
    queueOpen,
  );
  const waiting = count.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil((queue.data?.total ?? 0) / QUEUE_PAGE));
  // The last proof of a page was decided: step back instead of showing an empty page.
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('panels.applicants')}</h2>
      <div className="flex flex-wrap items-center gap-2">
        {waiting > 0 ? (
          <Button
            variant="outline"
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((v) => !v)}
          >
            {t('applicantsPanel.checkFees', { num: formatNumber(waiting, region) })}
          </Button>
        ) : null}
        <Button asChild>
          <Link to="/admissions/applicants/new" search={{ round: roundId }}>
            {t('applicantsPanel.newApplication')}
          </Link>
        </Button>
      </div>

      {queueOpen && waiting > 0 ? (
        <section aria-label={t('applicantsPanel.queueLabel')} className="rounded-md border p-3">
          <ul className="flex flex-col divide-y">
            {(queue.data?.data ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{row.applicant_name}</span>{' '}
                  <span className="text-sm text-muted-foreground">
                    {row.applicant_reference_number}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => setOpen(row)}>
                  {t('applicantsPanel.check')}
                </Button>
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className="mt-2 flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('applicantsPanel.previous')}
              </Button>
              <span className="text-sm">
                {t('applicantsPanel.page', {
                  current: formatNumber(page, region),
                  total: formatNumber(totalPages, region),
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                {t('applicantsPanel.next')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {testStage && unrolled > 0 ? (
        <NextActionCard
          title={t('applicantsPanel.rollPending.title', { num: formatNumber(unrolled, region) })}
          description={t('applicantsPanel.rollPending.description')}
          action={{
            label: t('applicantsPanel.rollPending.action'),
            onClick: () =>
              void navigate({
                to: '.',
                search: (prev: object) => ({ ...prev, step: testStage.id }),
                replace: true,
              }),
          }}
        />
      ) : null}

      <ApplicantList intakeId={roundId} />

      {open ? (
        <FeeVerifyDialog
          proof={open}
          amountPaisa={round.data?.fee_amount_paisa}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
