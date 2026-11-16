import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { CommunicationMedium, CommunicationTrigger, UserRole } from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { StaffAudienceService } from './staff-audience.service';
import { STAFF_MESSAGE_DUPLICATE, StaffMessagesService } from './staff-messages.service';

/**
 * [80.1.05] Real rows: one batch and one log per person (trigger STAFF_MESSAGE, no student or
 * guardian), credit reserve under batch:<id>, a refused reserve leaves nothing, the duplicate
 * guard, coordinator narrowing and another school's staff never reached. Only the queue and the
 * credit ledger are stubbed; the batch / log / audience SQL is real.
 */
describe('StaffMessagesService (integration)', () => {
  let ds: DataSource;
  let service: StaffMessagesService;
  const tag = randomUUID().slice(0, 8);
  let a: string;
  let b: string;
  let sender: string;
  let ids: Record<string, string> = {};
  const jobs: any[] = [];
  const reserved: { units: number; key: string }[] = [];
  let reserveOk = true;

  async function school(name: string): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [name, `sm-${name}-${tag}`],
    );
    return id;
  }
  async function member(key: string, tenant: string, role: UserRole): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, phone, status, created_at, updated_at)
       VALUES ($1, 'x', $2, $3, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`${key}-${tag}@sm.example`, key, `+8801${Math.floor(1e9 + Math.random() * 8e9)}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenant, role],
    );
    ids[key] = id;
    return id;
  }
  const counts = async (tenant: string) => ({
    batches: Number(
      (await ds.query(`SELECT count(*) FROM reminder_batches WHERE tenant_id = $1`, [tenant]))[0]
        .count,
    ),
    logs: Number(
      (await ds.query(`SELECT count(*) FROM communication_logs WHERE tenant_id = $1`, [tenant]))[0]
        .count,
    ),
  });
  const dto = (message: string, extra: object = {}): any => ({
    audience: { roles: [UserRole.OFFICE_STAFF] },
    message,
    medium: CommunicationMedium.SMS,
    ...extra,
  });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StaffAudienceService]);
    ds = module.get(getDataSourceToken());
    a = await school('a');
    b = await school('b');
    sender = await member('sender', a, UserRole.EXECUTIVE);
    await member('o1', a, UserRole.OFFICE_STAFF);
    await member('o2', a, UserRole.OFFICE_STAFF);
    await member('foreign', b, UserRole.OFFICE_STAFF);
    // Metered school: every reserve is recorded; `reserveOk` flips it to a refusal.
    const credits: any = {
      isMetered: async () => true,
      getBalance: async () => ({ available: 100, reserved: 0 }),
      reserve: async (_t: string, units: number, key: string) => {
        if (!reserveOk) return { ok: false, available: 0 };
        reserved.push({ units, key });
        return { ok: true };
      },
      settlePart: async () => undefined,
    };
    service = new StaffMessagesService(
      module.get(getRepositoryToken(CommunicationLog)),
      module.get(getRepositoryToken(ReminderBatch)),
      { add: async (_n: string, data: unknown) => void jobs.push(data) } as any,
      module.get(StaffAudienceService),
      credits,
      { record: async () => undefined } as any,
    );
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('writes one batch and one STAFF_MESSAGE log per person, reserving segments first', async () => {
    const res = await service.send(dto('Meeting at 3'), a, sender, UserRole.EXECUTIVE);
    expect(res).toMatchObject({ total_recipients: 2, queued: 2, failed: 0 });
    // 2 people x 1 segment, reserved under the batch id.
    expect(reserved.at(-1)).toEqual({ units: 2, key: `batch:${res.batch_id}` });
    const logs = await ds.query(
      `SELECT trigger, recipient_user_id, student_id, guardian_id, reminder_batch_id, sent_by_user_id
         FROM communication_logs WHERE reminder_batch_id = $1`,
      [res.batch_id],
    );
    expect(logs).toHaveLength(2);
    for (const l of logs) {
      expect(l.trigger).toBe(CommunicationTrigger.STAFF_MESSAGE);
      expect(l.student_id).toBeNull();
      expect(l.guardian_id).toBeNull();
      expect(l.sent_by_user_id).toBe(sender);
    }
    // Another school's office staff is never reached.
    expect(logs.map((l: any) => l.recipient_user_id)).not.toContain(ids.foreign);
    expect(logs.map((l: any) => l.recipient_user_id).sort()).toEqual([ids.o1, ids.o2].sort());
    expect(jobs).toHaveLength(2);
  });

  it('insufficient credit refuses the whole batch and leaves nothing behind', async () => {
    const before = await counts(a);
    reserveOk = false;
    await expect(
      service.send(dto('Different text'), a, sender, UserRole.EXECUTIVE),
    ).rejects.toMatchObject({ status: 409 });
    reserveOk = true;
    expect(await counts(a)).toEqual(before);
  });

  it('the same text and audience within 60 s is a 409, then nothing new is written', async () => {
    await service.send(dto('Once only'), a, sender, UserRole.EXECUTIVE);
    const before = await counts(a);
    await expect(service.send(dto('Once only'), a, sender, UserRole.EXECUTIVE)).rejects.toThrow(
      STAFF_MESSAGE_DUPLICATE,
    );
    expect(await counts(a)).toEqual(before);
  });

  it('a coordinator with no coordinated classes gets a 400 and nothing is written', async () => {
    const coord = await member('coord', a, UserRole.TEACHER);
    const before = await counts(a);
    await expect(
      service.send(
        dto('Hi', { audience: { roles: [UserRole.TEACHER] } }),
        a,
        coord,
        UserRole.TEACHER,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await counts(a)).toEqual(before);
  });
});
