import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentMethod, UserRole } from '@biddaloy/shared';
import { SEED_TENANT_ID } from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { AppModule } from '../../app.module';
import { StorageService } from '../storage/storage.service';
import { CreateProofSubmissionDto } from './dto/proof-submission.dto';
import { createProofFixture, JPEG } from '@test/helpers/proof-submissions.fixture';
import { ProofCaller, ProofSubmissionsService } from './proof-submissions.service';

class FakeStorage {
  static fail = false;
  static keys: string[] = [];
  async put(key: string) {
    if (FakeStorage.fail) throw new Error('s3 down');
    FakeStorage.keys.push(key);
  }
  async deleteForTenant(key: string) {
    FakeStorage.keys = FakeStorage.keys.filter((k) => k !== key);
  }
}

const file = (): Express.Multer.File =>
  ({ buffer: JPEG, mimetype: 'image/jpeg', size: JPEG.length, originalname: 'p.jpg' }) as never;

/** [3.x/#3965] Cross-row rules of proof submit, run against the real database. */
describe('ProofSubmissionsService (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let svc: ProofSubmissionsService;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  let ctx: ProofCaller;
  const today = new Date().toISOString().slice(0, 10);

  const dto = (billIds: string[], amount: number, over: Partial<CreateProofSubmissionDto> = {}) =>
    ({
      billIds,
      amount,
      method: PaymentMethod.BKASH,
      paidOn: '2000-01-01',
      reference: 'trx1',
      ...over,
    }) as CreateProofSubmissionDto;
  const rows = async (table: string) =>
    (
      await ds.query(`SELECT COUNT(*)::int n FROM ${table} WHERE tenant_id = $1`, [SEED_TENANT_ID])
    )[0].n as number;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useClass(FakeStorage)
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    await app.init();
    ds = app.get(DataSource);
    svc = app.get(ProofSubmissionsService);
    fix = await createProofFixture(app, ds);
    ctx = { tenantId: SEED_TENANT_ID, userId: fix.parent.id, role: UserRole.PARENT };
  }, 120000);

  afterAll(async () => {
    await fix?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    FakeStorage.fail = false;
    FakeStorage.keys = [];
    await fix.reset();
  });

  it('happy path: one submission with a row per bill across two children, audited', async () => {
    await fix.linkParentTo(fix.fx.studentB);
    const a = await fix.bill(fix.fx.studentA, 500);
    const b = await fix.bill(fix.fx.studentB, 250.5, 50); // balance 200.50
    const res = await svc.submit(dto([a, b], 700.5), [file()], ctx);
    expect(res.status).toBe('PENDING');
    expect(res.bills).toHaveLength(2);
    expect(res.files).toHaveLength(1);
    expect(FakeStorage.keys[0]).toContain(`tenants/${SEED_TENANT_ID}/payment-proofs/${res.id}/`);
    const audit = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_type='PaymentSubmission' AND entity_id=$1`,
      [res.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('refuses an amount off by one paisa', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    await expect(svc.submit(dto([a], 500.01), [], ctx)).rejects.toThrow(
      'The amount does not match the selected bills',
    );
    await expect(svc.submit(dto([a], 499.99), [], ctx)).rejects.toThrow(
      'The amount does not match the selected bills',
    );
    expect(await rows('payment_submissions')).toBe(0);
  });

  it('refuses a bill that is already paid', async () => {
    const a = await fix.bill(fix.fx.studentA, 500, 500, 'PAID');
    await expect(svc.submit(dto([a], 500), [], ctx)).rejects.toThrow('cannot take a payment proof');
  });

  it('refuses a bill held by a PENDING online submission (D24)', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const [s] = await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, amount, provider, environment)
       VALUES ($1,'ONLINE','PENDING',$2,500,'BKASH','SANDBOX') RETURNING id`,
      [SEED_TENANT_ID, fix.parent.id],
    );
    await ds.query(
      `INSERT INTO payment_submission_bills (tenant_id, submission_id, student_fee_id, student_id, amount_at_start)
       VALUES ($1,$2,$3,$4,500)`,
      [SEED_TENANT_ID, s.id, a, fix.fx.studentA],
    );
    await expect(svc.submit(dto([a], 500), [], ctx)).rejects.toThrow('cannot take a payment proof');
    expect(await svc.billsWithLiveSubmission(ds.manager, SEED_TENANT_ID, [a])).toEqual([a]);
  });

  it('refuses the 6th waiting proof', async () => {
    for (let i = 0; i < 5; i++) {
      const b = await fix.bill(fix.fx.studentA, 100);
      await svc.submit(dto([b], 100, { reference: `T${i}` }), [], ctx);
    }
    const sixth = await fix.bill(fix.fx.studentA, 100);
    await expect(svc.submit(dto([sixth], 100), [], ctx)).rejects.toThrow('Too many payment proofs');
  });

  it('refuses a future payment date', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    await expect(svc.submit(dto([a], 500, { paidOn: '2999-01-01' }), [], ctx)).rejects.toThrow(
      'cannot be in the future',
    );
    expect(today).toBeTruthy();
  });

  it('another family bill is 404 and writes nothing', async () => {
    const b = await fix.bill(fix.fx.studentB, 500);
    await expect(svc.submit(dto([b], 500), [], ctx)).rejects.toThrow('Bill not found');
    expect(await rows('payment_submissions')).toBe(0);
  });

  it('another family bill with a file writes no storage object (pre-check runs first)', async () => {
    const b = await fix.bill(fix.fx.studentB, 500);
    let puts = 0;
    const real = FakeStorage.prototype.put;
    FakeStorage.prototype.put = async function (k: string) {
      puts += 1;
      return real.call(this, k);
    };
    try {
      await expect(svc.submit(dto([b], 500), [file()], ctx)).rejects.toThrow('Bill not found');
    } finally {
      FakeStorage.prototype.put = real;
    }
    expect(puts).toBe(0);
  });

  it('a multi-child proof shows a guardian only their own child bills and amount', async () => {
    await fix.linkParentTo(fix.fx.studentB);
    const a = await fix.bill(fix.fx.studentA, 500);
    const b = await fix.bill(fix.fx.studentB, 200);
    const s = await svc.submit(dto([a, b], 700), [], ctx);
    // The other guardian is linked to B only.
    const otherCtx = { ...ctx, userId: fix.other.id };
    const [seen] = await svc.list(otherCtx, undefined);
    expect(seen.id).toBe(s.id);
    expect(seen.bills.map((x) => x.studentId)).toEqual([fix.fx.studentB]);
    expect(seen.amount).toBe('200.00');
    expect((await svc.list(ctx, undefined))[0].bills).toHaveLength(2);
  });

  it('storage failure with files saves nothing; reference-only works while storage is down', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    FakeStorage.fail = true;
    await expect(svc.submit(dto([a], 500), [file()], ctx)).rejects.toThrow(
      'Proof upload is unavailable',
    );
    expect(await rows('payment_submissions')).toBe(0);
    const ok = await svc.submit(dto([a], 500), [], ctx);
    expect(ok.status).toBe('PENDING');
  });

  it('flags a duplicate TrxID for review without refusing it (D25)', async () => {
    const a = await fix.bill(fix.fx.studentA, 100);
    const b = await fix.bill(fix.fx.studentA, 100);
    await svc.submit(dto([a], 100, { reference: ' dup9 ' }), [], ctx);
    const second = await svc.submit(dto([b], 100, { reference: 'DUP9' }), [], ctx);
    const [ev] = await ds.query(
      `SELECT reason_code FROM payment_submission_events WHERE submission_id=$1`,
      [second.id],
    );
    expect(ev.reason_code).toBe('DUPLICATE_PENDING');
  });

  it('withdraw: only the submitter, only while PENDING', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const s = await svc.submit(dto([a], 500), [], ctx);
    const otherCtx = { ...ctx, userId: fix.other.id };
    await expect(svc.withdraw(s.id, otherCtx)).rejects.toThrow('Payment proof not found');
    expect((await svc.withdraw(s.id, ctx)).status).toBe('WITHDRAWN');
    await expect(svc.withdraw(s.id, ctx)).rejects.toThrow('Only a waiting proof');
    expect(await svc.billsWithLiveSubmission(ds.manager, SEED_TENANT_ID, [a])).toEqual([]);
  });

  it('list: reject reason and note go to the submitter only; a co-guardian gets null', async () => {
    await fix.linkOtherTo(fix.fx.studentA);
    const a = await fix.bill(fix.fx.studentA, 500);
    const s = await svc.submit(dto([a], 500), [], ctx);
    await ds.query(
      `UPDATE payment_submissions SET status='REJECTED', reject_reason='OTHER', reject_note='call the office' WHERE id=$1`,
      [s.id],
    );
    const [mine] = await svc.list(ctx, undefined);
    expect(mine.rejectReason).toBe('OTHER');
    expect(mine.rejectNote).toBe('call the office');
    const [theirs] = await svc.list({ ...ctx, userId: fix.other.id }, undefined);
    expect(theirs.rejectReason).toBeNull();
    expect(theirs.rejectNote).toBeNull();
    expect(theirs.discardReason).toBeNull();
  });

  it('options: returns the method list and flags, never a bKash credential', async () => {
    await ds.query(
      `UPDATE schools SET settings = jsonb_set(settings, '{payments,bkash}', '{"appKey":"SECRET-KEY-3975"}') WHERE id=$1`,
      [SEED_TENANT_ID],
    );
    const o = await svc.options(ctx);
    expect(Object.keys(o).sort()).toEqual(['onlineEnabled', 'proofEnabled', 'proofMethods']);
    expect(o.proofEnabled).toBe(true);
    expect(o.proofMethods).toEqual([{ method: 'BKASH', instructions: 'Send to 017' }]);
    expect(JSON.stringify(o)).not.toContain('SECRET-KEY-3975');
  });

  it('cart: own children only, open bills only, waiting submission marked', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    await fix.bill(fix.fx.studentA, 100, 100, 'PAID'); // settled: not listed
    const foreign = await fix.bill(fix.fx.studentB, 300); // another family's child
    const s = await svc.submit(dto([a], 500), [], ctx);
    const cart = await svc.cart(ctx);
    expect(cart.students.map((x) => x.studentId)).toEqual([fix.fx.studentA]);
    const bills = cart.students[0].bills;
    expect(bills).toHaveLength(1);
    expect(bills[0].waitingSubmission).toEqual({ id: s.id, source: 'PROOF' });
    expect(JSON.stringify(cart)).not.toContain(foreign);
    // The other guardian sees only their own child, with no waiting mark.
    const theirs = await svc.cart({ ...ctx, userId: fix.other.id });
    expect(theirs.students.map((x) => x.studentId)).toEqual([fix.fx.studentB]);
    expect(theirs.students[0].bills[0].waitingSubmission).toBeNull();
    // A waiting proof by another linked guardian: source shown, id withheld.
    await ds.query(`UPDATE payment_submissions SET submitted_by_user_id = $1 WHERE id = $2`, [
      fix.other.id,
      s.id,
    ]);
    const co = await svc.cart(ctx);
    expect(co.students[0].bills[0].waitingSubmission).toEqual({ id: null, source: 'PROOF' });
  });
});
