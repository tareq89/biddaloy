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

import { SmsCreditSectionView } from './SmsCreditSectionView';

const PAGE_SIZE = 10;

export interface SmsCreditSectionProps {
  schoolId: string;
  /** `true` when `schoolId` is a SUPER_ADMIN's *picked* school rather than
   * their own active tenant — routes reads through the SUPER_ADMIN
   * cross-school endpoint (`GET /schools/:id/sms-credits`, #570) instead
   * of the tenant-scoped one, which would otherwise resolve to whatever
   * tenant is on the caller's JWT, not the picked school. */
  isSuperAdmin?: boolean;
}

export function SmsCreditSection({ schoolId, isSuperAdmin = false }: SmsCreditSectionProps) {
  const [page, setPage] = React.useState(1);
  // A schoolId change (SUPER_ADMIN's picker) must reset to page 1 — a
  // stale page number from a previous school's longer ledger would silently
  // request an out-of-range page for the new one.
  React.useEffect(() => {
    setPage(1);
  }, [schoolId]);

  const creditsQuery = useSmsCredits(page, PAGE_SIZE, isSuperAdmin ? schoolId : undefined);

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
    />
  );
}
