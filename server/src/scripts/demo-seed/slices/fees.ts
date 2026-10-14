import type { DemoSlice } from '../context';
import { FeeStructure } from '../../../modules/fees/entities/fee-structure.entity';
import { FineRule } from '../../../modules/fees/entities/fine-rule.entity';
import { RecurringSchedule } from '../../../modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../../../modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from '../../../modules/fees/entities/recurring-schedule-exclusion.entity';
import { DiscountRule } from '../../../modules/fees/entities/discount-rule.entity';
import { FeeGeneration } from '../../../modules/fees/entities/fee-generation.entity';
import { StudentFee } from '../../../modules/fees/entities/student-fee.entity';
import { Payment } from '../../../modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../../../modules/fees/entities/payment-allocation.entity';
import { Invoice } from '../../../modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from '../../../modules/invoices/entities/invoice-share-token.entity';
import { StudentWallet } from '../../../modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from '../../../modules/fees/entities/wallet-transaction.entity';

export const slice: DemoSlice = {
  name: 'fees',
  covers: [
    FeeStructure,
    FineRule,
    RecurringSchedule,
    RecurringScheduleStructure,
    RecurringScheduleExclusion,
    DiscountRule,
    FeeGeneration,
    StudentFee,
    Payment,
    PaymentAllocation,
    Invoice,
    InvoiceShareToken,
    StudentWallet,
    WalletTransaction,
  ],
  owedBy: '58.3.02',
  run: async () => {},
};
