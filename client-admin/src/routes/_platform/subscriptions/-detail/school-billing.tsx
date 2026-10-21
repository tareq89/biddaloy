/**
 * Epic 49 W4: `SchoolBillingView` wired to `GET /platform/billing/schools/:id` and the three
 * actions (grant, record payment, revive), each in its own dialog.
 */
import { SeatOrderStatus } from '@biddaloy/shared';
import { usePlatformSchoolBillingDetail, type SeatOrderDto } from '@biddaloy/ui/hooks';
import * as React from 'react';

import { GrantSeatsDialog } from './grant-seats-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { ReviveDialog } from './revive-dialog';
import { SchoolBillingView } from './school-billing-view';

export interface SchoolBillingProps {
  schoolId: string;
  schoolName: string;
}

export function SchoolBilling({ schoolId, schoolName }: SchoolBillingProps) {
  const query = usePlatformSchoolBillingDetail(schoolId);
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [reviveOpen, setReviveOpen] = React.useState(false);
  const [payOrder, setPayOrder] = React.useState<SeatOrderDto | null>(null);

  return (
    <>
      <SchoolBillingView
        detail={query.data}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onGrant={() => setGrantOpen(true)}
        onRevive={() => setReviveOpen(true)}
        onRecordPayment={(o) => o.status === SeatOrderStatus.PENDING && setPayOrder(o)}
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
    </>
  );
}
