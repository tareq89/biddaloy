/**
 * [8.10.5] — `Find Student → Outstanding Fees → Allocate → Method &
 * Reference → Confirm → Receipt`, as a `WizardShell`. `irreversible:
 * true` (recording a payment can't be undone from this screen) forces a
 * `reviewStep` by the type system — see `wizard-shell.tsx`'s own header
 * comment on why that isn't just documentation.
 *
 * Owns every piece of cross-step state itself rather than each step
 * holding its own: `WizardShell` keeps step content mounted-but-hidden
 * once visited, which is what makes "Back preserves entered data" true
 * without this component doing anything extra — but only for state that
 * actually lives up here, not state a step would otherwise own locally.
 */
import {
  useRecordPaymentWithAllocation,
  useStudent,
  useStudentFeeSummary,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWizardShellStep, WizardShell, type WizardStep } from '@biddaloy/ui/shells';
import { minorUnitsToDecimalString, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import * as React from 'react';

import { AllocateStep } from './allocate-step';
import {
  applyLineEdit,
  prefillFifoAllocations,
  summarizeAllocation,
  willFullyPayAllTouchedFees,
  type AllocationLine,
  type OutstandingFee,
} from './allocation-math';
import { ConfirmStep } from './confirm-step';
import { FindStudentStep } from './find-student-step';
import { MethodStep, type PaymentMethodValue } from './method-step';
import { OutstandingFeesStep } from './outstanding-fees-step';
import { Receipt } from './receipt';

// Statuses `payment-allocation.service.ts`'s `recordWithAllocation` locks
// and allocates against — mirrors its query's `status IN (...)` filter.
const ALLOCATABLE_STATUSES = new Set(['PENDING', 'PARTIALLY_PAID', 'OVERDUE']);

// Must include `confirm` — `useWizardShellStep`'s `setStep` silently
// no-ops for any id outside this list, and `WizardShell` navigates to the
// `reviewStep`'s id (`confirm`) via that same setter once the last
// regular step's "Next" is clicked.
const STEPS_WITH_FIND_STUDENT = [
  'find-student',
  'outstanding-fees',
  'allocate',
  'method',
  'confirm',
] as const;
const STEPS_WITHOUT_FIND_STUDENT = ['outstanding-fees', 'allocate', 'method', 'confirm'] as const;

export interface RecordPaymentWizardProps {
  /** Present when deep-linked from a student's "Collect fees" row action
   * (`record.tsx`'s `student_id` search param) — the Find Student step is
   * skipped entirely rather than rendered and pre-filled, since there's
   * nothing left for it to do. */
  initialStudentId?: string;
}

export function RecordPaymentWizard({ initialStudentId }: RecordPaymentWizardProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();
  const hasFindStudentStep = initialStudentId === undefined;

  const [pickedStudent, setPickedStudent] = React.useState<
    { id: string; full_name: string } | undefined
  >(undefined);
  const studentId = initialStudentId ?? pickedStudent?.id;

  const [stepId, setStepId] = useWizardShellStep(
    hasFindStudentStep ? STEPS_WITH_FIND_STUDENT : STEPS_WITHOUT_FIND_STUDENT,
  );

  // Only fetched on the deep-link path — a student picked via
  // `FindStudentStep` already carries its own `full_name`.
  const studentQuery = useStudent(hasFindStudentStep ? undefined : initialStudentId);
  const feeSummaryQuery = useStudentFeeSummary(studentId);
  const studentName = pickedStudent?.full_name ?? studentQuery.data?.full_name ?? '';

  const [totalMinorUnits, setTotalMinorUnits] = React.useState<number | undefined>(undefined);
  const [lines, setLines] = React.useState<AllocationLine[]>([]);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethodValue>('CASH');
  const [transactionReference, setTransactionReference] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [generateInvoice, setGenerateInvoice] = React.useState(true);

  const outstandingFees: OutstandingFee[] = React.useMemo(() => {
    const feeBreakdown = feeSummaryQuery.data?.fee_breakdown ?? [];
    return feeBreakdown
      .filter((fee) => ALLOCATABLE_STATUSES.has(fee.status))
      .map((fee) => {
        const totalMU = serverAmountToMinorUnits(fee.total_amount, config);
        const paidMU = serverAmountToMinorUnits(fee.paid_amount, config);
        const discountMU = serverAmountToMinorUnits(fee.discount_amount, config);
        return {
          id: fee.id,
          month: fee.month,
          year: fee.year,
          remainingMinorUnits: totalMU - paidMU - discountMU,
        };
      });
  }, [feeSummaryQuery.data, config]);

  // Re-prefills FIFO whenever the amount received changes — an edit made
  // under a previous amount doesn't carry over, since changing the
  // amount invalidates the whole breakdown anyway. Not re-run when
  // `outstandingFees` changes on its own (it's stable once fetched).
  React.useEffect(() => {
    if (totalMinorUnits === undefined || outstandingFees.length === 0) return;
    setLines(prefillFifoAllocations(outstandingFees, totalMinorUnits));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [totalMinorUnits]);

  const summary = summarizeAllocation(lines, totalMinorUnits ?? 0);
  const willFullyPay = willFullyPayAllTouchedFees(lines);

  const recordPayment = useRecordPaymentWithAllocation();

  function handleSelectStudent(student: { id: string; full_name: string }) {
    setPickedStudent(student);
    setStepId('outstanding-fees');
  }

  function handleSubmit() {
    if (studentId === undefined || totalMinorUnits === undefined) return;
    const touchedLines = lines.filter((line) => line.allocatedMinorUnits > 0);
    recordPayment.mutate({
      student_id: studentId,
      // Built from the exact minor-units integer via `minorUnitsToDecimalString`
      // (digit manipulation, no division) and only turned into a `number`
      // at the very last step — never `minorUnits / 100` directly, which
      // is exactly the float-drift risk this file avoids everywhere else.
      total_amount: Number(minorUnitsToDecimalString(totalMinorUnits, config)),
      payment_method: paymentMethod,
      allocations: touchedLines.map((line) => ({
        student_fee_id: line.studentFeeId,
        allocated_amount: Number(minorUnitsToDecimalString(line.allocatedMinorUnits, config)),
        allocation_type: line.allocationType,
      })),
      ...(transactionReference.trim() !== ''
        ? { transaction_reference: transactionReference.trim() }
        : {}),
      ...(remarks.trim() !== '' ? { remarks: remarks.trim() } : {}),
      generate_invoice: generateInvoice,
    });
  }

  const steps: WizardStep[] = [];

  if (hasFindStudentStep) {
    steps.push({
      id: 'find-student',
      label: t('record.steps.findStudent'),
      content: <FindStudentStep onSelect={handleSelectStudent} />,
      isValid: () => studentId !== undefined,
    });
  }

  steps.push(
    {
      id: 'outstanding-fees',
      label: t('record.steps.outstandingFees'),
      content: (
        <OutstandingFeesStep
          studentName={studentName}
          feeSummaryQuery={feeSummaryQuery}
          totalMinorUnits={totalMinorUnits}
          onTotalChange={setTotalMinorUnits}
        />
      ),
      isValid: () => totalMinorUnits !== undefined && totalMinorUnits > 0,
    },
    {
      id: 'allocate',
      label: t('record.steps.allocate'),
      content: (
        <AllocateStep
          lines={lines}
          summary={summary}
          totalMinorUnits={totalMinorUnits ?? 0}
          onLineChange={(feeId, value) =>
            setLines((current) => applyLineEdit(current, feeId, value ?? 0))
          }
        />
      ),
      isValid: () => lines.some((line) => line.allocatedMinorUnits > 0) && !summary.overAllocated,
    },
    {
      id: 'method',
      label: t('record.steps.method'),
      content: (
        <MethodStep
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          transactionReference={transactionReference}
          onTransactionReferenceChange={setTransactionReference}
          remarks={remarks}
          onRemarksChange={setRemarks}
          generateInvoice={generateInvoice}
          onGenerateInvoiceChange={setGenerateInvoice}
          willFullyPay={willFullyPay}
        />
      ),
    },
  );

  return (
    <WizardShell
      title={t('record.title')}
      steps={steps}
      currentStepId={stepId}
      onStepChange={setStepId}
      irreversible
      reviewStep={{
        id: 'confirm',
        label: t('record.steps.confirm'),
        content: (
          <ConfirmStep
            studentName={studentName}
            totalMinorUnits={totalMinorUnits ?? 0}
            lines={lines}
            paymentMethod={paymentMethod}
            transactionReference={transactionReference}
            generateInvoice={generateInvoice}
            willFullyPay={willFullyPay}
            submitError={recordPayment.error}
          />
        ),
      }}
      onSubmit={handleSubmit}
      submitLabel={t('record.confirm.submitAction')}
      submitting={recordPayment.isPending}
      result={
        recordPayment.isSuccess ? (
          <Receipt payment={recordPayment.data} studentName={studentName} />
        ) : undefined
      }
    />
  );
}
