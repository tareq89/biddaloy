import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { GuardianProvisioningService } from './guardian-provisioning.service';
import { MAX_BATCH_INVITE_SELECTION } from './invitation-batch.constants';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';

describe('GuardianProvisioningService.preview — paging `all` (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: GuardianProvisioningService;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    service = new GuardianProvisioningService(
      ds.getRepository(Guardian),
      ds.getRepository(User),
      ds.getRepository(CommunicationLog),
      ds.getRepository(AuditLog),
      {} as any,
      {} as any,
      { add: vi.fn() } as any,
    );
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM guardians');
    await ds.query('DELETE FROM schools');
    const schools = ds.getRepository(School);
    await schools.save(
      schools.create({
        id: SEED_TENANT_ID,
        name: 'paging-t',
        slug: 'paging-t',
        tenant_id: SEED_TENANT_ID,
      }),
    );
    // One more than the cap. No email/phone, so each is classified `no_contact`
    // and the test needs no account lookups.
    const repo = ds.getRepository(Guardian);
    const rows = Array.from({ length: MAX_BATCH_INVITE_SELECTION + 1 }, (_, i) => ({
      full_name: `Guardian ${i}`,
      relationship: 'Father',
      tenant_id: SEED_TENANT_ID,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await repo.insert(rows.slice(i, i + 500));
    }
  });

  it('returns the first 1000 with next_after, then the remaining 1 with next_after null', async () => {
    const first = await service.preview(SEED_TENANT_ID, { all: true });
    expect(first.total).toBe(MAX_BATCH_INVITE_SELECTION);
    expect(first.next_after).not.toBeNull();

    const second = await service.preview(SEED_TENANT_ID, {
      all: true,
      after: first.next_after as string,
    });
    expect(second.total).toBe(1);
    expect(second.next_after).toBeNull();

    // The two slices never overlap.
    const firstIds = new Set(first.skipped.map((e) => e.guardian_id));
    expect(second.skipped.every((e) => !firstIds.has(e.guardian_id))).toBe(true);
  });

  it('refuses `after` without `all`', async () => {
    await expect(
      service.preview(SEED_TENANT_ID, {
        guardian_ids: ['00000000-0000-4000-8000-000000000001'],
        after: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses an explicit guardian_ids selection over the cap', async () => {
    const ids = (await ds.getRepository(Guardian).find({ select: { id: true } })).map((g) => g.id);
    await expect(service.preview(SEED_TENANT_ID, { guardian_ids: ids })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
