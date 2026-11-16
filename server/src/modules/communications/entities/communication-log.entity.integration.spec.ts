import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CommunicationMedium, CommunicationTrigger } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { User } from '../../users/entities/user.entity';
import { CommunicationLog } from './communication-log.entity';

/** [80.1.03] `communication_logs.recipient_user_id` against the migrated schema. */
describe('CommunicationLog entity (integration)', () => {
  let dataSource: DataSource;
  const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const repo = () => dataSource.getRepository(CommunicationLog);
  const makeLog = (extra: Partial<CommunicationLog>) =>
    repo().save({
      tenant_id: SEED_TENANT_ID,
      medium: CommunicationMedium.SMS,
      recipient_address: '+8801700000000',
      recipient_name: 'Staff',
      message_body: 'hello',
      ...extra,
    });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  it('keeps the log with a null recipient_user_id when the user is deleted', async () => {
    const user = await dataSource
      .getRepository(User)
      .save({ email: `cl-${tag()}@test.com`, full_name: 'CL Staff' });
    const log = await makeLog({ recipient_user_id: user.id });
    expect((await repo().findOneByOrFail({ id: log.id })).recipient_user_id).toBe(user.id);

    await dataSource.getRepository(User).delete({ id: user.id });

    // Audit record survives; only the pointer is nulled.
    const after = await repo().findOneByOrFail({ id: log.id });
    expect(after.recipient_user_id).toBeNull();
  });

  it('accepts the STAFF_MESSAGE and MARKS_SMS triggers', async () => {
    for (const trigger of [CommunicationTrigger.STAFF_MESSAGE, CommunicationTrigger.MARKS_SMS]) {
      const log = await makeLog({ trigger });
      expect((await repo().findOneByOrFail({ id: log.id })).trigger).toBe(trigger);
    }
  });
});
