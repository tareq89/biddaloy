import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { Guardian } from '../../students/entities/guardian.entity';
import { CommunicationLog } from '../entities/communication-log.entity';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import { SmsCreditLedger } from './entities/sms-credit-ledger.entity';
import { SmsCreditService } from './sms-credit.service';
import { reconcileStrandedSmsCredit, ReconcileRow } from './sms-credit-reconcile';

/**
 * [#1317] Runs the operator reconcile against a real (throwaway) test DB.
 * Legacy reservations are created through the real `reserve` API with the
 * old, un-prefixed keys, exactly as the pre-fix code did.
 */
describe('reconcileStrandedSmsCredit (integration)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let ledgerRepo: Repository<SmsCreditLedger>;
  let balanceRepo: Repository<SmsCreditBalance>;
  let credits: SmsCreditService;
  let A: string;
  let B: string;
  let seq = 0;

  // One-segment body (plain ASCII, short).
  const ONE = 'Fee due soon';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    ledgerRepo = module.get(getRepositoryToken(SmsCreditLedger));
    balanceRepo = module.get(getRepositoryToken(SmsCreditBalance));
    credits = new SmsCreditService(balanceRepo, ledgerRepo, dataSource, {
      getResolvedSettings: async () => ({}),
    } as any);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'recon-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  beforeEach(async () => {
    A = await makeSchool('Reconcile A');
    B = await makeSchool('Reconcile B');
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [A, B]);
  });

  async function addLog(
    tenantId: string,
    over: Partial<CommunicationLog> = {},
  ): Promise<CommunicationLog> {
    seq += 1;
    return logRepo.save({
      tenant_id: tenantId,
      medium: CommunicationMedium.SMS,
      recipient_address: `+8801000000${String(seq).padStart(3, '0')}`,
      recipient_name: 'Recipient',
      message_body: ONE,
      status: CommunicationStatus.SENT,
      trigger: CommunicationTrigger.AUTOMATED,
      ...over,
    } as CommunicationLog);
  }

  async function legacyReserve(tenantId: string, units: number, key: string, refId: string | null) {
    const res = await credits.reserve(tenantId, units, key, { type: 'batch', id: refId });
    expect(res).toEqual({ ok: true });
  }

  /** The fixtures for one tenant; `G` is reused across tenants on purpose. */
  const G = '11111111-1111-4111-8111-111111111111';
  const PAY = '33333333-3333-4333-8333-333333333333';
  const INV1 = '44444444-4444-4444-8444-444444444444';
  const INV2 = '55555555-5555-4555-8555-555555555555';
  const OVER = '66666666-6666-4666-8666-666666666666';

  async function makeGuardian(tenantId: string): Promise<string> {
    const g = await dataSource
      .getRepository(Guardian)
      .save({ tenant_id: tenantId, full_name: 'Guardian', relationship: 'Mother' } as Guardian);
    return g.id;
  }

  async function seed(tenantId: string) {
    const GUARDIAN = await makeGuardian(tenantId);
    const otherGuardian = await makeGuardian(tenantId);
    await credits.grant(tenantId, 100, { idempotencyKey: `seed:${tenantId}` });
    const fee = (over: Partial<CommunicationLog>, meta: Record<string, any> = {}) =>
      addLog(tenantId, { metadata: { fee_generation_id: G, ...meta }, ...over });

    // Fee reserve: 6 logs x 1u + a skipped row + a WhatsApp log that don't count.
    await legacyReserve(tenantId, 6, `fee-notify:${G}:sms`, G);
    const sent = await fee({});
    const suspended = await fee(
      { status: CommunicationStatus.FAILED },
      { reason: 'TENANT_SUSPENDED' },
    );
    const noProvider = await fee(
      { status: CommunicationStatus.FAILED },
      { error: 'No provider registered for medium "SMS"' },
    );
    const unsettled = await fee(
      { status: CommunicationStatus.FAILED },
      { error: 'rejected', credit: 'UNSETTLED' },
    );
    const queued = await fee({ status: CommunicationStatus.QUEUED });
    const enqueueFailed = await fee(
      { status: CommunicationStatus.FAILED },
      { reason: 'ENQUEUE_FAILED' },
    );
    await fee(
      { status: CommunicationStatus.FAILED, message_body: '' },
      { reason: 'SKIPPED_NO_SMS' },
    );
    await fee({ medium: CommunicationMedium.WHATSAPP });

    // Payment reserve with one SENT log.
    const payKey = `payment-notify:${PAY}:${GUARDIAN}`;
    await legacyReserve(tenantId, 1, payKey, null);
    const pay = await addLog(tenantId, { reference_key: payKey });

    // Invoice send: reserve 1 has exactly one candidate, reserve 2 has none.
    await legacyReserve(tenantId, 1, `invoice-send:${INV1}:${GUARDIAN}`, INV1);
    const inv = await addLog(tenantId, {
      trigger: CommunicationTrigger.MANUAL,
      guardian_id: GUARDIAN,
      message_body: 'Invoice https://x/i/abc',
    });
    await legacyReserve(tenantId, 1, `invoice-send:${INV2}:${otherGuardian}`, INV2);

    // Result SMS: never linkable.
    await legacyReserve(tenantId, 3, `exam-result-sms:${OVER}`, OVER);

    // Two SENT logs against a 1-unit reserve.
    const overKey = '88888888-8888-4888-8888-888888888888';
    await legacyReserve(tenantId, 1, `fee-notify:${overKey}:sms`, overKey);
    const over1 = await addLog(tenantId, { metadata: { fee_generation_id: overKey } });
    const over2 = await addLog(tenantId, { metadata: { fee_generation_id: overKey } });

    // Post-fix reserve that must never appear as stranded.
    await credits.reserve(tenantId, 1, 'batch:incident:abc', {
      type: 'batch',
      id: '99999999-9999-4999-8999-999999999999',
    });

    return {
      sent,
      suspended,
      noProvider,
      unsettled,
      queued,
      enqueueFailed,
      pay,
      inv,
      over1,
      over2,
    };
  }

  const byReason = (rows: ReconcileRow[], reason: string) =>
    rows.filter((r) => r.reason === reason);

  async function snapshot(tenantId: string) {
    return {
      ledger: await ledgerRepo.find({ where: { tenant_id: tenantId }, order: { id: 'ASC' } }),
      balance: await balanceRepo.findOneOrFail({ where: { tenant_id: tenantId } }),
      logs: await logRepo.find({ where: { tenant_id: tenantId }, order: { id: 'ASC' } }),
    };
  }

  it('dry run reports every outcome and changes nothing', async () => {
    const f = await seed(A);
    const before = await snapshot(A);

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: false,
      tenantId: A,
    });

    const rowFor = (id: string) => rep.rows.find((r) => r.logId === id);
    expect(rowFor(f.sent.id)).toMatchObject({ action: 'DEBIT', reason: 'SENT', units: 1 });
    expect(rowFor(f.suspended.id)).toMatchObject({ action: 'RELEASE', reason: 'TENANT_SUSPENDED' });
    expect(rowFor(f.noProvider.id)).toMatchObject({ action: 'RELEASE', reason: 'NO_PROVIDER' });
    expect(rowFor(f.unsettled.id)).toMatchObject({
      action: 'MANUAL_REVIEW',
      reason: 'FAILED_OUTCOME_UNKNOWN',
    });
    expect(rowFor(f.queued.id)).toMatchObject({ action: 'IN_FLIGHT' });
    expect(rowFor(f.enqueueFailed.id)).toMatchObject({
      action: 'MANUAL_REVIEW',
      reason: 'ENQUEUE_FAILED_REPLAYABLE',
    });
    expect(rowFor(f.pay.id)).toMatchObject({ action: 'DEBIT', source: 'PAYMENT_NOTIFY' });
    expect(rowFor(f.inv.id)).toMatchObject({ action: 'DEBIT', source: 'INVOICE_SEND' });
    expect(byReason(rep.rows, 'AMBIGUOUS_LINK')).toHaveLength(1);
    expect(byReason(rep.rows, 'NO_LOG_LINK')).toHaveLength(1);
    // Two SENT logs vs a 1-unit reserve: one DEBIT, one EXCEEDS_RESERVATION.
    expect(rowFor(f.over1.id)?.action).toBe('DEBIT');
    expect(rowFor(f.over2.id)).toMatchObject({
      action: 'MANUAL_REVIEW',
      reason: 'EXCEEDS_RESERVATION',
    });
    // Skipped row and WhatsApp log never appear; batch: reserve never appears.
    expect(rep.strandedReserves).toBe(6);
    expect(rep.rows.every((r) => r.tenantId === A)).toBe(true);

    expect(await snapshot(A)).toEqual(before);
  });

  it('apply settles via settlePart with the worker part key, once', async () => {
    const f = await seed(A);
    const start = await snapshot(A);

    const [first] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: true,
      tenantId: A,
    });
    const settles = first.rows.filter((r) => r.action === 'DEBIT' || r.action === 'RELEASE');
    // sent, suspended, noProvider, pay, inv, over1
    expect(settles).toHaveLength(6);
    const debitUnits = settles.filter((r) => r.action === 'DEBIT').reduce((n, r) => n + r.units, 0);
    const releaseUnits = settles
      .filter((r) => r.action === 'RELEASE')
      .reduce((n, r) => n + r.units, 0);
    expect(debitUnits).toBe(4);
    expect(releaseUnits).toBe(2);

    const sentRow = await ledgerRepo.findOneByOrFail({
      tenant_id: A,
      idempotency_key: `log:${f.sent.id}:settle`,
    });
    expect(sentRow).toMatchObject({ kind: 'DEBIT', units: 1, reason: 'reconcile #1317' });
    const supRow = await ledgerRepo.findOneByOrFail({
      tenant_id: A,
      idempotency_key: `log:${f.suspended.id}:settle`,
    });
    expect(supRow.kind).toBe('RELEASE');

    const after = await snapshot(A);
    expect(after.balance.reserved).toBe(start.balance.reserved - 6);
    expect(after.balance.available).toBe(start.balance.available + releaseUnits);
    const sentLog = await logRepo.findOneByOrFail({ id: f.sent.id, tenant_id: A });
    expect(sentLog.metadata?.credit).toBe('DEBITED');
    // Untouched rows keep their metadata.
    const unsettled = await logRepo.findOneByOrFail({ id: f.unsettled.id, tenant_id: A });
    expect(unsettled.metadata?.credit).toBe('UNSETTLED');
    const queued = await logRepo.findOneByOrFail({ id: f.queued.id, tenant_id: A });
    expect(queued.metadata?.credit).toBeUndefined();

    // Second apply: nothing new, ledger and balance identical.
    const [second] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: true,
      tenantId: A,
    });
    expect(second.rows.filter((r) => r.action === 'DEBIT' || r.action === 'RELEASE')).toHaveLength(
      0,
    );
    // The fee reserve still has unresolved logs, so its 3 settled logs are listed; the
    // payment, invoice and over-reserve are fully settled and skipped (counted only).
    expect(second.rows.filter((r) => r.action === 'ALREADY_SETTLED')).toHaveLength(3);
    expect(second.settledReserves).toBe(3);
    const again = await snapshot(A);
    expect(again.ledger.length).toBe(after.ledger.length);
    expect(again.balance).toMatchObject({
      available: after.balance.available,
      reserved: after.balance.reserved,
    });
  });

  it('a late worker settle after reconcile is a no-op (same part key)', async () => {
    const f = await seed(A);
    await reconcileStrandedSmsCredit(dataSource, credits, { apply: true, tenantId: A });
    const before = await snapshot(A);
    // The worker settles under the batch: key, which does not exist for legacy rows, and
    // a replay under the legacy key with the same log key must not move units again.
    await credits.settlePart(A, `fee-notify:${G}:sms`, `log:${f.sent.id}`, 1, 'DEBIT');
    const after = await snapshot(A);
    expect(after.ledger.length).toBe(before.ledger.length);
    expect(after.balance).toMatchObject({
      available: before.balance.available,
      reserved: before.balance.reserved,
    });
  });

  it('keeps tenants isolated and honours the --tenant filter', async () => {
    await seed(A);
    await seed(B);
    const beforeB = await snapshot(B);

    await reconcileStrandedSmsCredit(dataSource, credits, { apply: true, tenantId: A });
    expect(await snapshot(B)).toEqual(beforeB);

    const all = await reconcileStrandedSmsCredit(dataSource, credits, { apply: true });
    const reportB = all.find((r) => r.tenantId === B)!;
    expect(reportB.rows.every((r) => r.tenantId === B)).toBe(true);
    expect(reportB.rows.filter((r) => r.action === 'DEBIT').length).toBeGreaterThan(0);
    // B's balance moved against B's own ledger only.
    const afterB = await snapshot(B);
    expect(afterB.balance.reserved).toBeLessThan(beforeB.balance.reserved);
  });

  it('repairs metadata when the ledger row exists but the flag is stale', async () => {
    const f = await seed(A);
    await credits.settlePart(A, `fee-notify:${G}:sms`, `log:${f.sent.id}`, 1, 'DEBIT');
    await logRepo.update({ id: f.sent.id, tenant_id: A }, {
      metadata: { fee_generation_id: G, credit: 'UNSETTLED' },
    } as never);
    const ledgerBefore = await ledgerRepo.count({ where: { tenant_id: A } });

    await reconcileStrandedSmsCredit(dataSource, credits, { apply: true, tenantId: A });

    const log = await logRepo.findOneByOrFail({ id: f.sent.id, tenant_id: A });
    expect(log.metadata?.credit).toBe('DEBITED');
    // Only the other settleable logs added rows; the repaired one added none.
    expect(
      await ledgerRepo.count({
        where: { tenant_id: A, idempotency_key: `log:${f.sent.id}:settle` },
      }),
    ).toBe(1);
    expect(await ledgerRepo.count({ where: { tenant_id: A } })).toBeGreaterThan(ledgerBefore);
  });

  it('lists (never acts on) post-fix reserves whose listener enqueue failed', async () => {
    await credits.grant(A, 10, { idempotencyKey: `seed:${A}` });
    await credits.reserve(A, 1, `batch:fee-notify:${G}:sms`, { type: 'batch', id: G });
    const feeLog = await addLog(A, {
      status: CommunicationStatus.FAILED,
      metadata: { fee_generation_id: G, reason: 'ENQUEUE_FAILED' },
    });
    const GUARDIAN = '22222222-2222-4222-8222-222222222222';
    const payKey = `payment-notify:${PAY}:${GUARDIAN}`;
    await credits.reserve(A, 1, `batch:${payKey}`, { type: 'log', id: null });
    const payLog = await addLog(A, {
      status: CommunicationStatus.FAILED,
      reference_key: payKey,
      metadata: { reason: 'ENQUEUE_FAILED' },
    });
    const before = await snapshot(A);

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: true,
      tenantId: A,
    });

    expect(rep.strandedReserves).toBe(0);
    expect(rep.rows.map((r) => [r.logId, r.action, r.reason]).sort()).toEqual(
      [
        [feeLog.id, 'MANUAL_REVIEW', 'ENQUEUE_FAILED_HOLDING_UNITS'],
        [payLog.id, 'MANUAL_REVIEW', 'ENQUEUE_FAILED_HOLDING_UNITS'],
      ].sort(),
    );
    expect((await snapshot(A)).ledger).toEqual(before.ledger);
    expect((await snapshot(A)).balance).toEqual(before.balance);
  });

  it('flags a legacy reserve that also has a batch: twin as SPLIT_ACROSS_DEPLOY', async () => {
    await credits.grant(A, 10, { idempotencyKey: `seed:${A}` });
    await legacyReserve(A, 1, `fee-notify:${G}:sms`, G);
    await credits.reserve(A, 1, `batch:fee-notify:${G}:sms`, { type: 'batch', id: G });
    await addLog(A, { metadata: { fee_generation_id: G } });

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: true,
      tenantId: A,
    });
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0]).toMatchObject({ action: 'MANUAL_REVIEW', reason: 'SPLIT_ACROSS_DEPLOY' });
  });

  it('sends legacy invoice reserves that share one reference to MANUAL_REVIEW, never settles them', async () => {
    // Main wrote these as {type:'manual', id: invoiceId}: both guardians share INV1.
    await credits.grant(A, 10, { idempotencyKey: `seed:${A}` });
    const g1 = await makeGuardian(A);
    const g2 = await makeGuardian(A);
    for (const g of [g1, g2]) {
      const res = await credits.reserve(A, 1, `invoice-send:${INV1}:${g}`, {
        type: 'manual',
        id: INV1,
      });
      expect(res).toEqual({ ok: true });
      await addLog(A, {
        trigger: CommunicationTrigger.MANUAL,
        guardian_id: g,
        message_body: 'Invoice https://x/i/abc',
      });
    }
    const before = await snapshot(A);

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: true,
      tenantId: A,
    });

    expect(rep.rows).toHaveLength(2);
    expect(rep.rows.every((r) => r.reason === 'SHARED_REFERENCE')).toBe(true);
    expect(rep.rows.every((r) => r.action === 'MANUAL_REVIEW' && r.units === 1)).toBe(true);
    expect(rep.settledReserves).toBe(0);
    expect((await snapshot(A)).ledger).toEqual(before.ledger);
  });

  it('reports units no log accounts for as ORPHAN_UNITS and unknown keys as UNKNOWN_KEY', async () => {
    await credits.grant(A, 10, { idempotencyKey: `seed:${A}` });
    await legacyReserve(A, 3, `fee-notify:${G}:sms`, G);
    const only = await addLog(A, { metadata: { fee_generation_id: G } });
    await legacyReserve(A, 2, 'weird:key', null);

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: false,
      tenantId: A,
    });

    expect(rep.rows.find((r) => r.logId === only.id)).toMatchObject({ action: 'DEBIT', units: 1 });
    expect(byReason(rep.rows, 'ORPHAN_UNITS')).toMatchObject([{ units: 2, logId: null }]);
    expect(byReason(rep.rows, 'UNKNOWN_KEY')).toMatchObject([{ units: 2, logId: null }]);
  });

  it('dry run lists a stale-metadata row as ALREADY_SETTLED without repairing it', async () => {
    const f = await seed(A);
    await credits.settlePart(A, `fee-notify:${G}:sms`, `log:${f.sent.id}`, 1, 'DEBIT');
    await logRepo.update({ id: f.sent.id, tenant_id: A }, {
      metadata: { fee_generation_id: G, credit: 'UNSETTLED' },
    } as never);
    const before = await snapshot(A);

    const [rep] = await reconcileStrandedSmsCredit(dataSource, credits, {
      apply: false,
      tenantId: A,
    });

    expect(rep.rows.find((r) => r.logId === f.sent.id)?.action).toBe('ALREADY_SETTLED');
    expect(await snapshot(A)).toEqual(before);
  });

  it('all-tenant apply leaves exact balances for both tenants', async () => {
    await seed(A);
    await seed(B);
    await reconcileStrandedSmsCredit(dataSource, credits, { apply: true });
    // Per tenant: reserved 14 (6+1+1+1+3+1 legacy, 1 post-fix); 4 debits + 2 releases settle 6.
    for (const t of [A, B]) {
      const { balance } = await snapshot(t);
      expect(balance).toMatchObject({ available: 88, reserved: 8 });
    }
  });
});
