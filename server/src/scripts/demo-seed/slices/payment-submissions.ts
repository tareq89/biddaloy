import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PaymentMethod,
  PaymentProofRejectReason,
  PaymentSubmissionStatus,
  UserRole,
} from '@biddaloy/shared';
import { PaymentSubmission } from '../../../modules/payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../../../modules/payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from '../../../modules/payment-submissions/entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from '../../../modules/payment-submissions/entities/payment-submission-event.entity';
import { ProofSubmissionsService } from '../../../modules/payment-submissions/proof-submissions.service';
import { ProofReviewService } from '../../../modules/payment-submissions/proof-review.service';
import { CheckoutService } from '../../../modules/fees/checkout.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import type { CreateProofSubmissionDto } from '../../../modules/payment-submissions/dto/proof-submission.dto';
import type { DemoSlice, DemoSeedContext } from '../context';
import { orgIds } from './org';
import { staffByCardKey } from './staff';
import { studentIds } from './students';

/**
 * [3.x/#3973] Guardian payment proofs in every state, all through the real services. Only the PROOF
 * rows live here; #3988 adds the ONLINE ones to this same slice.
 *
 * All seven sit in `bmsc-high`, so the `accountant` card sees the two waiting ones (and the alert
 * "2 payment proofs are waiting"). The `guardian` card's High child carries the first proofs.
 */

const PLACEHOLDER = readFileSync(join(__dirname, '..', 'assets', 'payment-proof-placeholder.png'));
const png = (): Express.Multer.File =>
  ({
    buffer: PLACEHOLDER,
    mimetype: 'image/png',
    size: PLACEHOLDER.length,
    originalname: 'proof.png',
  }) as Express.Multer.File;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/** One planned proof: what the guardian sends and what happens to it next. */
type Fate = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'DISCARDED' | 'WITHDRAWN';
interface Plan {
  fate: Fate;
  method: PaymentMethod;
  withRef: boolean;
  withFile: boolean;
  daysAgo: number;
  /** Shares the previous plan's TrxID, so the second one carries DUPLICATE_PENDING. */
  duplicateOfPrevious?: boolean;
}
const PLANS: Plan[] = [
  { fate: 'PENDING', method: PaymentMethod.BKASH, withRef: true, withFile: true, daysAgo: 3 },
  {
    fate: 'PENDING',
    method: PaymentMethod.BKASH,
    withRef: true,
    withFile: true,
    daysAgo: 1,
    duplicateOfPrevious: true,
  },
  { fate: 'CONFIRMED', method: PaymentMethod.BKASH, withRef: true, withFile: true, daysAgo: 4 },
  { fate: 'CONFIRMED', method: PaymentMethod.CASH, withRef: false, withFile: true, daysAgo: 5 },
  { fate: 'REJECTED', method: PaymentMethod.BKASH, withRef: false, withFile: true, daysAgo: 2 },
  { fate: 'DISCARDED', method: PaymentMethod.BKASH, withRef: true, withFile: false, daysAgo: 6 },
  { fate: 'WITHDRAWN', method: PaymentMethod.CASH, withRef: false, withFile: true, daysAgo: 1 },
];

export const slice: DemoSlice = {
  name: 'payment-submissions',
  covers: [PaymentSubmission, PaymentSubmissionBill, PaymentSubmissionFile, PaymentSubmissionEvent],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const high = org.tenants.find((t) => t.slug === 'bmsc-high');
    const accountant = staffByCardKey(ctx).get('accountant');
    if (!high || !accountant)
      throw new Error('payment-submissions: bmsc-high or accountant missing');

    // Proofs on, BKASH + CASH, in every branch. Raw SQL like the fees slice (no encryption needed here).
    for (const t of org.tenants) {
      await ctx.ds.query(
        `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('payments',
           COALESCE(settings->'payments', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
        [
          t.id,
          JSON.stringify({
            proofEnabled: true,
            proofMethods: [
              {
                method: 'BKASH',
                instructions: 'বিকাশ পার্সোনাল নম্বরে সেন্ড মানি করে TrxID লিখুন।',
              },
              { method: 'CASH', instructions: 'অফিসে নগদ জমা দিয়ে রসিদের ছবি তুলুন।' },
            ],
          }),
        ],
      );
      ctx.app.get(TenantSettingsCache, { strict: false }).invalidate(t.id);
    }

    // Open bills of High students whose guardian can log in; the guardian card's family first.
    const cardUser = studentIds(ctx).cards.guardianUserId;
    const bills: { bill: string; student: string; user: string; balance: string }[] =
      await ctx.ds.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (sf.id) sf.id AS bill, s.id AS student, g.user_id AS "user",
                  (sf.total_amount - sf.discount_amount - sf.paid_amount)::text AS balance,
                  s.id AS sid, s.full_name AS fname
             FROM student_fees sf
             JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
             JOIN student_guardians sg ON sg.student_id = s.id
             JOIN guardians g ON g.id = sg.guardian_id AND g.user_id IS NOT NULL
            WHERE sf.deleted_at IS NULL AND sf.status IN ('PENDING', 'PARTIALLY_PAID')
              AND sf.total_amount - sf.discount_amount - sf.paid_amount > 0
            ORDER BY sf.id
         ) x ORDER BY ("user" = $2) DESC, fname, sid, bill LIMIT $3`,
        [high.id, cardUser, PLANS.length],
      );
    // A tiny CI run (--scale 0.05) has few login families: run as many plans as there are bills.
    // The first one alone covers every entity (bill, file, event), so one bill is enough.
    if (bills.length < 1) {
      throw new Error(`payment-submissions: only ${bills.length} open bills for guardians`);
    }

    const submit = ctx.app.get(ProofSubmissionsService);
    const review = ctx.app.get(ProofReviewService);
    const checkout = ctx.app.get(CheckoutService);
    const staff = { tenantId: high.id, userId: accountant.userId };
    let sharedRef = '';
    let rows = 0;

    for (const [i, plan] of PLANS.slice(0, bills.length).entries()) {
      const b = bills[i];
      const guardian = { tenantId: high.id, userId: b.user, role: UserRole.PARENT };
      if (!plan.duplicateOfPrevious) {
        sharedRef = `DM${ctx.rng.string.alphanumeric({ length: 8, casing: 'upper' })}`;
      }
      const dto = {
        billIds: [b.bill],
        method: plan.method,
        amount: Number(b.balance),
        paidOn: addDays(ctx.anchor, -plan.daysAgo),
        reference: plan.withRef ? sharedRef : undefined,
      } as CreateProofSubmissionDto;
      const made = await submit.submit(dto, plan.withFile ? [png()] : [], guardian);
      rows += 3 + (plan.withFile ? 1 : 0);

      if (plan.fate === 'PENDING') {
        // The waiting ones look like they arrived `daysAgo` days ago (the oldest turns the alert red).
        await ctx.ds.query(`UPDATE payment_submissions SET created_at = $2 WHERE id = $1`, [
          made.id,
          new Date(Date.parse(`${ctx.anchor}T04:00:00Z`) - plan.daysAgo * 86_400_000),
        ]);
      } else if (plan.fate === 'CONFIRMED') {
        await review.confirm(made.id, staff);
        rows += 2;
      } else if (plan.fate === 'REJECTED') {
        await review.reject(made.id, { reason: PaymentProofRejectReason.IMAGE_UNCLEAR }, staff);
        rows += 1;
      } else if (plan.fate === 'DISCARDED') {
        // The family paid at the counter first, so confirming finds nothing left to settle.
        await checkout.checkout(
          {
            idempotency_key: ctx.rng.string.uuid(),
            lines: [{ student_fee_id: b.bill, amount: Number(b.balance) }],
            payment_method: PaymentMethod.CASH,
          },
          high.id,
          org.adminUserId,
          { headers: {} },
          { replayed: false, notify: false },
        );
        const res = await review.confirm(made.id, staff);
        if (res.outcome !== 'DISCARDED') throw new Error('payment-submissions: expected DISCARDED');
        rows += 4;
      } else {
        await submit.withdraw(made.id, guardian);
        rows += 1;
      }
    }
    return rows;
  },
};

export const PROOF_STATUS_COUNTS: Record<string, number> = {
  [PaymentSubmissionStatus.PENDING]: 2,
  [PaymentSubmissionStatus.CONFIRMED]: 2,
  [PaymentSubmissionStatus.REJECTED]: 1,
  [PaymentSubmissionStatus.DISCARDED]: 1,
  [PaymentSubmissionStatus.WITHDRAWN]: 1,
};
