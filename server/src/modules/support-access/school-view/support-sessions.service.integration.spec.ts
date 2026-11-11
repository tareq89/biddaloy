import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { SupportAccessMode, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { IMPERSONATION_REDIS } from '../sessions/impersonation-redis';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { SupportSessionsService } from './support-sessions.service';

describe('SupportSessionsService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: SupportSessionsService;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    module = await createTestModule(ALL_ENTITIES, [
      SupportSessionsService,
      ImpersonationSessionService,
      AuditService,
      { provide: IMPERSONATION_REDIS, useValue: redis },
      {
        provide: SchoolSettingsReader,
        useValue: { supportAccessFresh: async () => ({ mode: SupportAccessMode.ALLOWED }) },
      },
      { provide: SupportAccessNoticeService, useValue: {} },
    ]);
    ds = module.get(DataSource);
    svc = module.get(SupportSessionsService);
  }, 60000);

  afterAll(async () => {
    redis?.disconnect();
    await module?.close();
  });

  const mkUser = (n: string) =>
    ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `${n} ${randomUUID().slice(0, 6)}`,
        status: UserStatus.ACTIVE,
      }),
    );

  async function world() {
    const sfx = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${sfx}`, slug: `s-${sfx}` }));
    const owner = await mkUser('Owner');
    await ds.getRepository(PlatformAdmin).save({ user_id: owner.id });
    const person = await mkUser('Teacher');
    const session = async (o: { status?: string; ago?: string; expiresIn?: string } = {}) => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO impersonation_sessions
           (id, platform_admin_id, tenant_id, target_user_id, role, status, entry_kind, view_only,
            write_locked, reason, requested_at, started_at, expires_at)
         VALUES ($1,$2,$3,$4,'TEACHER',$5,'NORMAL',true,true,'Help',
                 now() - $6::interval, now() - $6::interval, now() + $7::interval)`,
        [
          id,
          owner.id,
          school.id,
          person.id,
          o.status ?? 'ACTIVE',
          o.ago ?? '1 hour',
          o.expiresIn ?? '1 hour',
        ],
      );
      return id;
    };
    // Raw insert: audit_logs is append-only but accepts inserts.
    const audit = (o: {
      action: string;
      by?: string | null;
      sid?: string | null;
      entity?: string;
      values?: object | null;
      tenant?: string;
    }) =>
      ds.query(
        `INSERT INTO audit_logs (tenant_id, action, entity_type, performed_by_user_id,
                                 impersonation_session_id, new_values)
         VALUES ($1, $2::audit_logs_action_enum, $3, $4, $5, $6)`,
        [
          o.tenant ?? school.id,
          o.action,
          o.entity ?? 'School',
          o.by === undefined ? owner.id : o.by,
          o.sid ?? null,
          o.values ? JSON.stringify(o.values) : null,
        ],
      );
    return { school, owner, person, session, audit };
  }

  it('school B sessions never appear for A; 91 day old and REQUESTED rows are excluded', async () => {
    const a = await world();
    const b = await world();
    const mine = await a.session();
    await a.session({ ago: '91 days' });
    await a.session({ status: 'REQUESTED' });
    await b.session();
    const list = await svc.listSessions(a.school.id);
    expect(list.map((x) => x.id)).toEqual([mine]);
    expect(list[0]).toMatchObject({ role: 'TEACHER', status: 'ACTIVE', viewOnly: true });
  });

  it('changedCount counts only stamped rows of this school, not the start/end rows', async () => {
    const w = await world();
    const sid = await w.session();
    await w.audit({ action: 'IMPERSONATION_STARTED', sid });
    await w.audit({ action: 'UPDATE', sid, entity: 'Student' });
    await w.audit({ action: 'CREATE', sid, entity: 'Student' });
    await w.audit({ action: 'UPDATE', entity: 'Student' }); // not stamped
    await w.audit({ action: 'IMPERSONATION_ENDED', sid });
    expect((await svc.listSessions(w.school.id))[0].changedCount).toBe(2);
  });

  it('platform actions: whitelist only, own school only, no sessions, no system rows', async () => {
    const a = await world();
    const b = await world();
    await a.audit({ action: 'SUSPEND', values: { reason: 'unpaid' } });
    await a.audit({ action: 'UPDATE', values: { units: 100, reason: 'gift' } });
    await a.audit({ action: 'UPDATE', values: { event: 'SEATS_GRANTED', reason: 'trial' } });
    // excluded: other school, stamped, system performer, a non-whitelisted owner row, a school admin
    await b.audit({ action: 'SUSPEND' });
    await a.audit({ action: 'REACTIVATE', sid: await a.session() });
    await a.audit({ action: 'SUSPEND', by: null });
    await a.audit({ action: 'IMPERSONATION_STARTED' });
    await a.audit({ action: 'UPDATE', values: { name: 'x' } });
    await a.audit({ action: 'UPDATE', by: a.person.id, values: { units: 5 } });
    const items = await svc.listPlatformActions(a.school.id);
    expect(items.map((i) => i.label).sort()).toEqual([
      'supportAccess.platformAction.seatsGranted',
      'supportAccess.platformAction.smsCreditsChanged',
      'supportAccess.platformAction.suspended',
    ]);
    expect(items.find((i) => i.label.endsWith('suspended'))?.reason).toBe('unpaid');
  });

  it('ending a session of another school is 404 and leaves it live', async () => {
    const a = await world();
    const b = await world();
    const sid = await b.session();
    await expect(svc.end(a.school.id, sid)).rejects.toMatchObject({ status: 404 });
    const [row] = await ds.query('SELECT status FROM impersonation_sessions WHERE id=$1', [sid]);
    expect(row.status).toBe('ACTIVE');
  });

  it('ending own session writes ENDED by SCHOOL_ADMIN; a second end is a 200', async () => {
    const w = await world();
    const sid = await w.session();
    await expect(svc.end(w.school.id, sid)).resolves.toEqual({ id: sid, status: 'ENDED' });
    await expect(svc.end(w.school.id, sid)).resolves.toEqual({ id: sid, status: 'ENDED' });
    const [row] = await ds.query(
      'SELECT status, ended_by FROM impersonation_sessions WHERE id=$1',
      [sid],
    );
    expect(row).toMatchObject({ status: 'ENDED', ended_by: 'SCHOOL_ADMIN' });
  });
});
