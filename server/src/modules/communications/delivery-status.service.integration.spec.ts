import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { DeliveryStatusService } from './delivery-status.service';

/**
 * [97.4.01] D23 check-status against the real schema: the jsonb merge keeps the other metadata
 * keys, status flips only when final, a provider error leaves the row as it was, the sink never
 * reaches a vendor, and one school cannot touch another's log. The provider is a fake (no network);
 * the vendor call itself is covered by each provider's spec with fetchPinnedJson mocked.
 */
describe('DeliveryStatusService (integration)', () => {
  let dataSource: DataSource;
  let service: DeliveryStatusService;
  let tenantA: string;
  let tenantB: string;
  const getStatus = vi.fn();
  const registry = {
    resolveFor: vi.fn(async () => ({
      provider: {
        descriptor: { medium: CommunicationMedium.SMS, name: 'stub-sms', capabilities: ['status'] },
        getStatus,
      },
      config: { apiKey: 'k' },
      source: 'tenant',
    })),
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    service = new DeliveryStatusService(
      module.get(getRepositoryToken(CommunicationLog)),
      registry as any,
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'dlv-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  async function addSentLog(tenantId: string, metadata: object): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO communication_logs
         (tenant_id, medium, recipient_address, recipient_name, message_body, status, provider_message_id, metadata, created_at, updated_at)
       VALUES ($1, 'SMS', '01700000000', 'Test', 'hi', 'SENT', 'vendor-1', $2, NOW(), NOW()) RETURNING id`,
      [tenantId, JSON.stringify(metadata)],
    );
    return id;
  }

  const row = async (id: string) =>
    (
      await dataSource.query(`SELECT status, metadata FROM communication_logs WHERE id = $1`, [id])
    )[0] as { status: string; metadata: Record<string, any> };

  beforeEach(async () => {
    getStatus.mockReset();
    tenantA = await makeSchool('Dlv Int A');
    tenantB = await makeSchool('Dlv Int B');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await dataSource.query(`DELETE FROM communication_logs WHERE tenant_id IN ($1, $2)`, [
      tenantA,
      tenantB,
    ]);
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  it('DELIVERED: sets status and merges metadata.delivery, keeping the other keys', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms', segments: 2, credit: 'DEBITED' });
    getStatus.mockResolvedValue({ status: 'DELIVERED', code: '000' });

    const dto = await service.checkStatus(id, tenantA);

    expect(dto).toMatchObject({ id, status: CommunicationStatus.DELIVERED, provider: 'stub-sms' });
    const stored = await row(id);
    expect(stored.status).toBe('DELIVERED');
    expect(stored.metadata).toMatchObject({
      provider: 'stub-sms',
      segments: 2,
      credit: 'DEBITED',
      delivery: { status: 'DELIVERED', code: '000', checkedAt: expect.any(String) },
    });
  });

  it('PENDING: stays SENT, writes checkedAt, and a second check inside a minute is a 409', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockResolvedValue({ status: 'PENDING' });

    await service.checkStatus(id, tenantA);

    const stored = await row(id);
    expect(stored.status).toBe('SENT');
    expect(stored.metadata.delivery).toEqual({ status: 'PENDING', checkedAt: expect.any(String) });
    await expect(service.checkStatus(id, tenantA)).rejects.toBeInstanceOf(ConflictException);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('FAILED: a final vendor failure sets status FAILED', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockResolvedValue({ status: 'FAILED', code: '1001' });

    await service.checkStatus(id, tenantA);

    expect((await row(id)).status).toBe('FAILED');
  });

  it('a provider error is a 502 and the row is unchanged', async () => {
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });
    getStatus.mockRejectedValue(new Error('raw vendor text'));

    await expect(service.checkStatus(id, tenantA)).rejects.toBeInstanceOf(BadGatewayException);

    expect(await row(id)).toEqual({ status: 'SENT', metadata: { provider: 'stub-sms' } });
  });

  it('another school’s log id is a 404 and nothing is written', async () => {
    const foreign = await addSentLog(tenantB, { provider: 'stub-sms' });

    await expect(service.checkStatus(foreign, tenantA)).rejects.toBeInstanceOf(NotFoundException);

    expect(getStatus).not.toHaveBeenCalled();
    expect(await row(foreign)).toEqual({ status: 'SENT', metadata: { provider: 'stub-sms' } });
  });

  it('MESSAGE_SINK=mailpit: a seeded SENT row with a vendor id is a 409, no vendor call', async () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const id = await addSentLog(tenantA, { provider: 'stub-sms' });

    await expect(service.checkStatus(id, tenantA)).rejects.toBeInstanceOf(ConflictException);

    expect(getStatus).not.toHaveBeenCalled();
    expect((await row(id)).metadata).toEqual({ provider: 'stub-sms' });
  });
});
