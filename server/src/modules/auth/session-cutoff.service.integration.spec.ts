import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SessionCutoffService } from './session-cutoff.service';
import { User } from '../users/entities/user.entity';

describe('SessionCutoffService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: SessionCutoffService;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [SessionCutoffService]);
    dataSource = module.get(DataSource);
    service = module.get(SessionCutoffService);
  });

  afterAll(async () => {
    await module.close();
  });

  async function makeUser(name: string): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(repo.create({ full_name: name, status: UserStatus.ACTIVE }));
  }

  async function cutOffOf(id: string): Promise<Date | null> {
    const [row] = await dataSource.query('SELECT tokens_valid_after FROM users WHERE id = $1', [
      id,
    ]);
    return row.tokens_valid_after;
  }

  it('cutOff sets tokens_valid_after for that user only', async () => {
    const target = await makeUser('Cut Off');
    const other = await makeUser('Untouched');

    await service.cutOff(target.id);

    expect(await cutOffOf(target.id)).toBeInstanceOf(Date);
    // Another account's sessions must never be affected.
    expect(await cutOffOf(other.id)).toBeNull();
  });

  it('cutOff inside a rolled-back transaction leaves the column NULL', async () => {
    const user = await makeUser('Rolled Back');

    await expect(
      dataSource.transaction(async (manager) => {
        await service.cutOff(user.id, manager);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await cutOffOf(user.id)).toBeNull();
  });
});
