import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { RecordPaymentModal } from './record-payment-modal';

/**
 * [16.4.4]'s single-Dialog replacement for the old six-step wizard.
 *
 * Same Storybook-not-wired-for-`client-admin` gap `generate-fees-
 * modal.stories.tsx`/`-create-school-wizard.stories.tsx` note — only
 * `ui/src/**` is globbed into this repo's Storybook config today
 * (`ui/.storybook/main.ts:25`), so this file isn't reachable from a
 * running Storybook instance yet. Written anyway, following that
 * precedent, so it's ready once that wiring gap is fixed.
 */
const meta: Meta<typeof RecordPaymentModal> = {
  component: RecordPaymentModal,
  args: {
    open: true,
    onOpenChange: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof RecordPaymentModal>;

function bill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    student_fee_id: 'fee-1',
    fee_name: 'Tuition — March',
    fee_type: 'TUITION',
    period_start: '2026-03-01',
    period_type: 'MONTH',
    occurrence: 1,
    total_amount: 5000,
    standing_discount_amount: 0,
    one_off_discount_amount: 0,
    paid_amount: 0,
    balance: 5000,
    due_date: '2026-03-10',
    is_late_fee: false,
    is_overdue: false,
    suggested_allocation: 5000,
    ...overrides,
  };
}

function cartHandler(overrides: Partial<Record<string, unknown>> = {}) {
  return http.get('/api/v1/payments/cart', () =>
    HttpResponse.json({
      students: [
        {
          id: 'student-1',
          full_name: 'Rahim Uddin',
          registration_number: '12345678',
          class_name: 'Six',
          section_name: 'A',
          wallet_balance: 0,
          bills: [bill()],
        },
      ],
      total_balance: 5000,
      suggested: {
        allocations: [{ student_fee_id: 'fee-1', amount: 5000 }],
        wallet_used: 0,
        remaining: 0,
        to_wallet: 0,
      },
      ...overrides,
    }),
  );
}

export const SingleStudent: Story = {
  args: { studentId: 'student-1' },
  parameters: { msw: { handlers: [cartHandler()] } },
};

export const TwoStudentsWithSiblings: Story = {
  args: { guardianId: 'guardian-1' },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/guardians/:id', () =>
          HttpResponse.json({
            id: 'guardian-1',
            full_name: 'Karim Ahmed',
            students: [
              { id: 'student-1', full_name: 'Rahim Uddin' },
              { id: 'student-2', full_name: 'Fatema Begum' },
            ],
          }),
        ),
        http.get('/api/v1/payments/cart', ({ request }) => {
          const ids = (new URL(request.url).searchParams.get('student_ids') ?? '').split(',');
          return HttpResponse.json({
            students: ids.map((id) => ({
              id,
              full_name: id === 'student-1' ? 'Rahim Uddin' : 'Fatema Begum',
              registration_number: id,
              class_name: 'Six',
              section_name: 'A',
              wallet_balance: 0,
              bills: [bill({ student_fee_id: `${id}-fee` })],
            })),
            total_balance: 10000,
            suggested: { allocations: [], wallet_used: 0, remaining: 0, to_wallet: 0 },
          });
        }),
      ],
    },
  },
};

export const WithOverdueAndLateFee: Story = {
  args: { studentId: 'student-1' },
  parameters: {
    msw: {
      handlers: [
        cartHandler({
          students: [
            {
              id: 'student-1',
              full_name: 'Rahim Uddin',
              registration_number: '12345678',
              class_name: 'Six',
              section_name: 'A',
              wallet_balance: 0,
              bills: [bill({ is_overdue: true, is_late_fee: true })],
            },
          ],
        }),
      ],
    },
  },
};

export const DiscountApplied: Story = {
  args: { studentId: 'student-1' },
  parameters: { msw: { handlers: [cartHandler()] } },
};

export const CashTenderWithChange: Story = {
  args: { studentId: 'student-1' },
  parameters: { msw: { handlers: [cartHandler()] } },
};

export const EmptyCart: Story = {
  args: { studentId: 'student-1' },
  parameters: {
    msw: {
      handlers: [
        cartHandler({
          students: [
            {
              id: 'student-1',
              full_name: 'Rahim Uddin',
              registration_number: '12345678',
              class_name: 'Six',
              section_name: 'A',
              wallet_balance: 0,
              bills: [],
            },
          ],
          total_balance: 0,
        }),
      ],
    },
  },
};

export const CartError: Story = {
  args: { studentId: 'student-1' },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/payments/cart', () =>
          HttpResponse.json(
            {
              statusCode: 500,
              message: 'Unable to load the cart',
              timestamp: new Date().toISOString(),
              path: '/api/v1/payments/cart',
              requestId: 'req-1',
            },
            { status: 500 },
          ),
        ),
      ],
    },
  },
};
