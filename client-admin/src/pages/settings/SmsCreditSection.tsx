/**
 * [15.6.8/#551] Settings' SMS credit section — sits next to `SmsSection`
 * (the provider *config* form) but is read-only and owns a different
 * endpoint entirely: `GET /communications/sms-credits` (#550), not
 * `GET/PATCH /schools/:id/settings`. `metering` here is the source of
 * truth for the mode label — the masked settings response
 * (`MaskedSmsSettingsResponseDto`) never surfaces the tenant's
 * `communications.sms.metering` flag, only the credits endpoint does.
 *
 * The actual markup lives in `SmsCreditSectionView` (presentational, no
 * hooks) so Storybook can render every state — loading, error, OFF,
 * PLATFORM, empty/populated ledger — from plain props rather than a live
 * `useSmsCredits()` call. This file wires the query and owns the page
 * cursor.
 */
import { useSmsCredits } from '@biddaloy/ui/hooks';
import * as React from 'react';

import { SmsBundlesPanel } from './SmsBundlesPanel';
import { SmsCreditSectionView } from './SmsCreditSectionView';
import { SmsSourceCard } from './SmsSourceCard';

const PAGE_SIZE = 25; // D19
const POLL_EVERY_MS = 3000;
const POLL_LIMIT_MS = 2 * 60 * 1000; // same give-up rule as SeatsBillingSection

export interface SmsCreditSectionProps {
  schoolId: string;
  /** `true` when `schoolId` is a SUPER_ADMIN's *picked* school rather than
   * their own active tenant — routes reads through the SUPER_ADMIN
   * cross-school endpoint (`GET /platform/schools/:id/sms-credits`, #570) instead
   * of the tenant-scoped one, which would otherwise resolve to whatever
   * tenant is on the caller's JWT, not the picked school. */
  isSuperAdmin?: boolean;
  /** [100.4.02] `?smsBuy=1`: open the buy dialog. */
  smsBuy?: boolean;
  /** `?smsOrder=<id>`: bKash's return for a package order; its status is polled and shown. */
  smsOrder?: string | undefined;
  payment?: 'success' | 'cancel' | 'failure' | 'error' | undefined;
  /** Drops `?smsBuy=1` once its dialog closes. */
  onBuyClosed?: () => void;
}

export function SmsCreditSection({
  schoolId,
  isSuperAdmin = false,
  smsBuy = false,
  smsOrder,
  payment,
  onBuyClosed,
}: SmsCreditSectionProps) {
  const [page, setPage] = React.useState(1);
  // A schoolId change (SUPER_ADMIN's picker) must reset to page 1 — a
  // stale page number from a previous school's longer ledger would silently
  // request an out-of-range page for the new one.
  React.useEffect(() => {
    setPage(1);
  }, [schoolId]);

  const creditsQuery = useSmsCredits(page, PAGE_SIZE, isSuperAdmin ? schoolId : undefined);

  // After bKash: refresh the balance until the order settles, give up after 2 minutes.
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    setTimedOut(false);
    if (!smsOrder) return;
    const id = window.setTimeout(() => setTimedOut(true), POLL_LIMIT_MS);
    return () => window.clearTimeout(id);
  }, [smsOrder]);
  const settled = creditsQuery.data?.orders.some(
    (o) => o.id === smsOrder && o.status !== 'PENDING',
  );
  const { refetch } = creditsQuery;
  const polling =
    Boolean(smsOrder) && !timedOut && !settled && (payment === undefined || payment === 'success');
  React.useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => void refetch(), POLL_EVERY_MS);
    return () => window.clearInterval(id);
  }, [polling, refetch]);

  const credits = creditsQuery.data;
  // A school on its own SMS company is unmetered (OFF) but still gets the offer to switch (D9).
  const sells = credits?.metering === 'PLATFORM' || credits?.source === 'OWN';

  return (
    <SmsCreditSectionView
      loading={creditsQuery.isLoading}
      error={creditsQuery.isError}
      {...(creditsQuery.data !== undefined ? { credits: creditsQuery.data } : {})}
      page={page}
      pageSize={PAGE_SIZE}
      isFetching={creditsQuery.isFetching}
      onPageChange={setPage}
      onRetry={() => void creditsQuery.refetch()}
      beforeHistory={
        credits && sells ? (
          <SmsBundlesPanel
            credits={credits}
            canBuy={!isSuperAdmin}
            openBuy={smsBuy}
            returnOrderId={smsOrder}
            payment={payment}
            pollTimedOut={timedOut}
            {...(onBuyClosed ? { onBuyClosed } : {})}
          />
        ) : undefined
      }
      afterHistory={
        credits && sells && !isSuperAdmin && credits.source === 'OWN' ? (
          <SmsSourceCard />
        ) : undefined
      }
    />
  );
}
