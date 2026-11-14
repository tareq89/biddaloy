/**
 * Epic 49 W4: `SchoolBillingView` wired to `GET /platform/billing/schools/:id` and the three
 * actions (grant, record payment, revive), each in its own dialog.
 */
import { SeatOrderStatus } from '@biddaloy/shared';
import { usePlatformSchoolBillingDetail, type SeatOrderDto } from '@biddaloy/ui/hooks';
import * as React from 'react';

import {
  RefundDialog,
  type RefundTarget,
} from '../../../../features/cockpit/money/billing/refund-dialog';
import { PlanChangeDialog } from '../../../../features/cockpit/money/plans/plan-change-dialog';

import { GrantSeatsDialog } from './grant-seats-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { ReviveDialog } from './revive-dialog';
import { SchoolBillingView, type SchoolBillingDetail } from './school-billing-view';

export interface SchoolBillingProps {
  schoolId: string;
  schoolName: string;
}

export function SchoolBilling({ schoolId, schoolName }: SchoolBillingProps) {
  const query = usePlatformSchoolBillingDetail(schoolId);
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [reviveOpen, setReviveOpen] = React.useState(false);
  const [payOrder, setPayOrder] = React.useState<SeatOrderDto | null>(null);
  const [refundOrder, setRefundOrder] = React.useState<RefundTarget | null>(null);
  const [planOpen, setPlanOpen] = React.useState(false);
  // The server's detail carries `plan` and typed package orders (#3888); the shared type is looser.
  const detail = query.data as SchoolBillingDetail | undefined;

  return (
    <>
      <SchoolBillingView
        detail={detail}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onGrant={() => setGrantOpen(true)}
        onRevive={() => setReviveOpen(true)}
        onRecordPayment={(o) => o.status === SeatOrderStatus.PENDING && setPayOrder(o)}
        onRefundSeat={(o) => setRefundOrder({ kind: 'seat', ...o })}
        onRefundPackage={(o) => setRefundOrder({ kind: 'package', ...o })}
        onChangePlan={() => setPlanOpen(true)}
      />
      <GrantSeatsDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        schoolId={schoolId}
        schoolName={schoolName}
      />
      <ReviveDialog
        open={reviveOpen}
        onOpenChange={setReviveOpen}
        schoolId={schoolId}
        schoolName={schoolName}
      />
      <RecordPaymentDialog
        open={payOrder !== null}
        onOpenChange={(open) => !open && setPayOrder(null)}
        schoolId={schoolId}
        schoolName={schoolName}
        order={payOrder}
      />
      <RefundDialog
        open={refundOrder !== null}
        onOpenChange={(open) => !open && setRefundOrder(null)}
        schoolId={schoolId}
        schoolName={schoolName}
        order={refundOrder}
      />
      <PlanChangeDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        schoolId={schoolId}
        schoolName={schoolName}
        currentPlanId={detail?.plan?.id}
      />
    </>
  );
}
