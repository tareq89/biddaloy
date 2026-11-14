import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { PaymentMethod, PaymentSubmissionSource, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { PaymentSubmission } from './entities/payment-submission.entity';
import { PaymentSubmissionEvent } from './entities/payment-submission-event.entity';

/**
 * [3.x/#3961] Per-row CHECKs and the TrxID partial unique of `payment_submissions`.
 * Cross-row rules (one waiting proof per bill, 5 per guardian) are NOT here: #3965.
 */
const T1 = '00000000-0000-4000-8000-000000000a01';
const T2 = '00000000-0000-4000-8000-000000000a02';
const GUARDIAN = '00000000-0000-4000-8000-000000000a11';

describe('payment_submissions constraints (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });

  // `test/setup.ts` truncates tables before every test, so reseed each time.
  beforeEach(async () => {
    const schools = ds.getRepository(School);
    await schools.save(schools.create({ id: T1, name: 'One', slug: 'ps-one' }));
    await schools.save(schools.create({ id: T2, name: 'Two', slug: 'ps-two' }));
    const users = ds.getRepository(User);
    await users.save(users.create({ id: GUARDIAN, full_name: 'G', status: UserStatus.ACTIVE }));
  });

  const base = (over: Partial<PaymentSubmission> = {}): Partial<PaymentSubmission> => ({
    tenant_id: T1,
    source: PaymentSubmissionSource.PROOF,
    submitted_by_user_id: GUARDIAN,
    method: PaymentMethod.BKASH,
    paid_on: '2026-11-01',
    amount: 500,
    ...over,
  });
  const insert = (v: Partial<PaymentSubmission>) =>
    ds.getRepository(PaymentSubmission).insert(v as never);
  const online = (over: Partial<PaymentSubmission> = {}) =>
    base({
      source: PaymentSubmissionSource.ONLINE,
      method: null,
      paid_on: null,
      provider: 'BKASH' as never,
      ...over,
    });

  it('accepts a valid PROOF and a valid ONLINE row', async () => {
    await insert(base());
    await insert(online());
    expect(await ds.getRepository(PaymentSubmission).count()).toBe(2);
  });

  it('rejects a PROOF without method', async () => {
    await expect(insert(base({ method: null }))).rejects.toThrow(/CHK_payment_submissions_proof/);
  });

  it('rejects a PROOF without paid_on', async () => {
    await expect(insert(base({ paid_on: null }))).rejects.toThrow(/CHK_payment_submissions_proof/);
  });

  it('rejects a PROOF that names a provider', async () => {
    await expect(insert(base({ provider: 'BKASH' as never }))).rejects.toThrow(
      /CHK_payment_submissions_proof/,
    );
  });

  it('rejects an ONLINE row without provider', async () => {
    await expect(insert(online({ provider: null }))).rejects.toThrow(
      /CHK_payment_submissions_online/,
    );
  });

  it('rejects an ONLINE row that carries a method', async () => {
    await expect(insert(online({ method: PaymentMethod.BKASH }))).rejects.toThrow(
      /CHK_payment_submissions_online/,
    );
  });

  it('rejects reject_reason OTHER without a note, accepts it with one', async () => {
    const other = { reject_reason: 'OTHER' as never };
    await expect(insert(base(other))).rejects.toThrow(/CHK_payment_submissions_reject_note/);
    await insert(base({ ...other, reject_note: 'blurry' }));
  });

  it('rejects zero, negative and over-cap amounts (money is bounded)', async () => {
    for (const amount of [0, -1, 100000000]) {
      await expect(insert(base({ amount }))).rejects.toThrow();
    }
    await insert(base({ amount: 99999999.99 }));
  });

  it('rejects a duplicate provider_trx_id in one tenant', async () => {
    await insert(online({ provider_trx_id: 'TRX1' }));
    await expect(insert(online({ provider_trx_id: 'TRX1' }))).rejects.toThrow(/IDX_ea8bb3c9/);
  });

  it('allows the same provider_trx_id in two tenants (tenant-scoped unique)', async () => {
    await insert(online({ provider_trx_id: 'TRX2' }));
    await insert(online({ tenant_id: T2, provider_trx_id: 'TRX2' }));
  });

  it('allows many rows with a null provider_trx_id', async () => {
    await insert(online());
    await insert(online());
  });

  it('stores an event with a null from_status (first row)', async () => {
    const res = await insert(base());
    const id = res.identifiers[0].id as string;
    const events = ds.getRepository(PaymentSubmissionEvent);
    await events.insert({
      tenant_id: T1,
      submission_id: id,
      from_status: null,
      to_status: 'PENDING' as never,
    });
    expect(await events.count()).toBe(1);
  });
});
