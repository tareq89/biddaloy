import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { SchoolRenameService } from './school-rename.service';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('SchoolRenameService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: SchoolRenameService;
  let homeId: string | undefined;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [AuditService]);
    ds = module.get(DataSource);
    svc = new SchoolRenameService(ds.getRepository(School), module.get(AuditService), {
      id: async () => homeId,
    } as never);
  });

  afterAll(async () => {
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);
  const school = () => {
    const s = sfx();
    return ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  };
  const owner = () =>
    ds
      .getRepository(User)
      .save(ds.getRepository(User).create({ full_name: `O ${sfx()}`, status: UserStatus.ACTIVE }));
  const rows = (tenantId: string) =>
    ds
      .getRepository(AuditLog)
      .find({ where: { tenant_id: tenantId, action: AuditAction.PLATFORM_SCHOOL_RENAMED } });

  it('renames, audits old and new once, keeps the slug; a repeat writes none', async () => {
    const s = await school();
    const other = await school();
    const o = await owner();
    const out = await svc.rename(s.id, { name: 'Brand New', reason: 'typo' }, o.id, context);
    expect(out).toMatchObject({ name: 'Brand New', changed: true });

    const after = await ds.getRepository(School).findOneByOrFail({ id: s.id });
    expect(after.name).toBe('Brand New');
    expect(after.slug).toBe(s.slug);
    expect((await ds.getRepository(School).findOneByOrFail({ id: other.id })).name).toBe(
      other.name,
    );

    const audit = await rows(s.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].old_values).toEqual({ name: s.name });
    expect(audit[0].new_values).toMatchObject({ name: 'Brand New', reason: 'typo' });
    expect(await rows(other.id)).toHaveLength(0);

    const again = await svc.rename(s.id, { name: 'Brand New', reason: 'typo' }, o.id, context);
    expect(again.changed).toBe(false);
    expect(await rows(s.id)).toHaveLength(1);
  });

  it('platform home is 409 and unknown id is 404', async () => {
    const home = await school();
    const o = await owner();
    homeId = home.id;
    await expect(
      svc.rename(home.id, { name: 'x', reason: 'r' }, o.id, context),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.rename(randomUUID(), { name: 'x', reason: 'r' }, o.id, context),
    ).rejects.toBeInstanceOf(NotFoundException);
    homeId = undefined;
  });
});
