import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentMethod, PaymentProofRejectReason, UserRole } from '@biddaloy/shared';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { createProofFixture, JPEG } from '@test/helpers/proof-submissions.fixture';
import { AppModule } from '../../app.module';
import { PaymentReversalService } from '../fees/payment-reversal.service';
import { StorageService } from '../storage/storage.service';
import { CreateProofSubmissionDto } from './dto/proof-submission.dto';
import { PAYMENT_SUBMISSION_EVENTS, paymentSubmissionEvents } from './payment-submission.events';
import { ProofReviewService, ReviewCaller } from './proof-review.service';
import { ProofCaller, ProofSubmissionsService } from './proof-submissions.service';

class FakeStorage {
  async put() {}
  async deleteForTenant() {}
}

const file = (): Express.Multer.File =>
  ({ buffer: JPEG, mimetype: 'image/jpeg', size: JPEG.length, originalname: 'p.jpg' }) as never;

/** [3.x/#3970] Staff proof review and reversal wiring against the real database. */
describe('ProofReviewService (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let submit: ProofSubmissionsService;
  let review: ProofReviewService;
  let reversal: PaymentReversalService;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  let guardian: ProofCaller;
  const staff: ReviewCaller = { tenantId: SEED_TENANT_ID, userId: SEED_ADMIN_USER_ID };
  let n = 0;

  /** Confirmed proofs leave payments behind; clear them (children first) so the fixture can wipe bills. */
  const scrub = async () => {
    await ds.query(`DELETE FROM payment_submissions WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id = $1)`,
      [SEED_TENANT_ID],
    );
    await ds.query(
      `UPDATE payments SET reversed_by_payment_id = NULL, reversal_of_payment_id = NULL WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    await ds.query(`UPDATE invoices SET payment_id = NULL WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM payments WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM invoices WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  };

  const dto = (billIds: string[], amount: number) =>
    ({
      billIds,
      amount,
      method: PaymentMethod.BKASH,
      paidOn: '2000-01-01',
      reference: `rev-trx-${(n += 1)}-${Date.now()}`,
    }) as CreateProofSubmissionDto;
  const newProof = async (amount = 300, studentId = fix.fx.studentA) => {
    const bill = await fix.bill(studentId, amount);
    const res = await submit.submit(dto([bill], amount), [file()], guardian);
    return { id: res.id, bill };
  };
  const events = (id: string) =>
    ds.query(
      `SELECT to_status, reason_code, note FROM payment_submission_events
        WHERE submission_id = $1 ORDER BY created_at, id`,
      [id],
    );
  const audits = async (id: string) =>
    (
      await ds.query(
        `SELECT COUNT(*)::int n FROM audit_logs WHERE entity_type='PaymentSubmission' AND entity_id=$1`,
        [id],
      )
    )[0].n as number;
  /** Resolves when the listener has finished writing one REVERSED row. */
  const nextReversed = () =>
    new Promise<void>((resolve) =>
      paymentSubmissionEvents.once(PAYMENT_SUBMISSION_EVENTS.REVERSED, () => resolve()),
    );

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useClass(FakeStorage)
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    await app.init();
    ds = app.get(DataSource);
    submit = app.get(ProofSubmissionsService);
    review = app.get(ProofReviewService);
    reversal = app.get(PaymentReversalService);
    fix = await createProofFixture(app, ds);
    guardian = { tenantId: SEED_TENANT_ID, userId: fix.parent.id, role: UserRole.PARENT };
  }, 120000);

  afterAll(async () => {
    await scrub();
    await fix?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await scrub();
    await fix.reset();
  });

  it('confirm happy path: one payment, status CONFIRMED, event and audit rows', async () => {
    const { id } = await newProof();
    const res = await review.confirm(id, staff);
    expect(res.outcome).toBe('SETTLED');
    expect(res.paymentIds).toHaveLength(1);
    expect(res.detail.status).toBe('CONFIRMED');
    expect((await events(id)).map((e: any) => e.to_status)).toEqual(['PENDING', 'CONFIRMED']);
    expect(await audits(id)).toBe(2); // submit + confirm
  });

  it('confirm when the bill was paid at the counter is DISCARDED, no payment', async () => {
    const { id, bill } = await newProof();
    await ds.query(
      `UPDATE student_fees SET paid_amount = total_amount, status = 'PAID' WHERE id = $1`,
      [bill],
    );
    const res = await review.confirm(id, staff);
    expect(res.outcome).toBe('DISCARDED');
    expect(res.paymentIds).toEqual([]);
    expect(res.detail.status).toBe('DISCARDED');
  });

  it('concurrent confirm makes one payment (D27)', async () => {
    const { id } = await newProof();
    const [a, b] = await Promise.all([review.confirm(id, staff), review.confirm(id, staff)]);
    expect(a.paymentIds).toEqual(b.paymentIds);
    const [{ n: payments }] = await ds.query(
      `SELECT COUNT(DISTINCT payment_id)::int n FROM payment_submission_bills WHERE submission_id = $1`,
      [id],
    );
    expect(payments).toBe(1);
  });

  it('reject needs a reason value; OTHER without a note is refused by the database rule', async () => {
    const { id } = await newProof();
    // The DTO turns OTHER-without-note into a 400 (e2e); the DB CHECK is the second wall.
    await expect(
      review.reject(id, { reason: PaymentProofRejectReason.OTHER } as never, staff),
    ).rejects.toThrow();
    const r = await review.reject(id, { reason: PaymentProofRejectReason.IMAGE_UNCLEAR }, staff);
    expect(r.status).toBe('REJECTED');
    expect(r.rejectReason).toBe('IMAGE_UNCLEAR');
    expect(await audits(id)).toBe(2);
  });

  it('reopen puts a rejected proof back to waiting, then confirm works', async () => {
    const { id } = await newProof();
    await review.reject(id, { reason: PaymentProofRejectReason.OTHER, note: 'blurry' }, staff);
    const r = await review.reopen(id, { note: 'guardian called' }, staff);
    expect(r.status).toBe('PENDING');
    expect((await review.confirm(id, staff)).outcome).toBe('SETTLED');
    expect((await events(id)).map((e: any) => e.to_status)).toEqual([
      'PENDING',
      'REJECTED',
      'PENDING',
      'CONFIRMED',
    ]);
  });

  it('rejecting a confirmed proof is a 409 with the fixed sentence', async () => {
    const { id } = await newProof();
    await review.confirm(id, staff);
    await expect(
      review.reject(id, { reason: PaymentProofRejectReason.DUPLICATE }, staff),
    ).rejects.toMatchObject({
      response: {
        message: expect.stringContaining('reverse the payment'),
        details: { code: 'PROOF_CONFIRMED_USE_REVERSAL' },
      },
    });
  });

  it('another tenant (unknown id) is not found, never a leak', async () => {
    await expect(review.detail('00000000-0000-4000-8000-0000000fffff', staff)).rejects.toThrow(
      'Payment proof not found',
    );
    const { id } = await newProof();
    await expect(
      review.confirm(id, {
        tenantId: '00000000-0000-4000-8000-0000000eeeee',
        userId: staff.userId,
      }),
    ).rejects.toThrow('Payment proof not found');
  });

  it('detail carries next_pending_id and list pages with a cursor', async () => {
    const first = await newProof(100);
    const second = await newProof(200);
    const d = await review.detail(first.id, staff);
    expect(d.next_pending_id).toBe(second.id);
    const p1 = await review.list(staff, { status: 'PENDING', limit: 1 });
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await review.list(staff, { status: 'PENDING', limit: 1, cursor: p1.nextCursor! });
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });

  it('reversing the proof payment sets REVERSED and writes one event row', async () => {
    const { id } = await newProof();
    const { paymentIds } = await review.confirm(id, staff);
    const done = nextReversed();
    await reversal.reverse(paymentIds[0], SEED_TENANT_ID, staff.userId, fix.parent.id, 'wrong');
    await done;
    const ev = (await events(id)).filter((e: any) => e.to_status === 'REVERSED');
    expect(ev).toHaveLength(1);
    expect(ev[0].note).toBe(`payment:${paymentIds[0]}`);
    const [{ status }] = await ds.query(`SELECT status FROM payment_submissions WHERE id=$1`, [id]);
    expect(status).toBe('REVERSED');
  });

  it('reversing one of two payments writes one event row, the other later adds its own', async () => {
    await fix.linkParentTo(fix.fx.studentB);
    const a = await fix.bill(fix.fx.studentA, 100);
    const b = await fix.bill(fix.fx.studentB, 200);
    const sub = await submit.submit(dto([a, b], 300), [file()], guardian);
    const { paymentIds } = await review.confirm(sub.id, staff);
    expect(paymentIds).toHaveLength(2);
    let done = nextReversed();
    await reversal.reverse(paymentIds[0], SEED_TENANT_ID, staff.userId, fix.parent.id, 'x');
    await done;
    const count = async () =>
      (await events(sub.id)).filter((e: any) => e.to_status === 'REVERSED').length;
    expect(await count()).toBe(1);
    done = nextReversed();
    await reversal.reverse(paymentIds[1], SEED_TENANT_ID, staff.userId, fix.parent.id, 'y');
    await done;
    expect(await count()).toBe(2); // one row per reversed payment
  });

  it('no event row is ever updated or deleted by the review paths', async () => {
    const { id } = await newProof();
    await review.reject(id, { reason: PaymentProofRejectReason.AMOUNT_MISMATCH }, staff);
    await review.reopen(id, { note: 'again' }, staff);
    const rows = await events(id);
    expect(rows).toHaveLength(3); // PENDING, REJECTED, PENDING: history only grows
  });
});
