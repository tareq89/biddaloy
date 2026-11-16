import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { AdmissionListDeadlineRule } from './admission-list-deadline.rule';
import { OfficeRulesModule } from './office-rules.module';

const DAY = '2043-03-02';

interface Tenant {
  id: string;
  adminId: string;
  officeId: string;
  teacherId: string;
  sectionId: string;
}

describe('AdmissionListDeadlineRule (integration)', () => {
  let ds: DataSource;
  let rule: AdmissionListDeadlineRule;
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: new Date('2043-03-02T04:00:00Z'),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });

  async function mkUser(tenantId: string, role: UserRole): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'List Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`list-${rand()}@example.com`],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id;
  }

  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('List Test', $1) RETURNING id`,
      [`list-${rand()}`],
    );
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Six', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, id],
    );
    return {
      id,
      sectionId,
      adminId: await mkUser(id, UserRole.ADMIN),
      officeId: await mkUser(id, UserRole.OFFICE_STAFF),
      teacherId: await mkUser(id, UserRole.TEACHER),
    };
  }

  async function mkIntake(t: Tenant, seats: number) {
    const [{ id }] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'Round', $3, '2043-01-01', '2043-02-01') RETURNING id`,
      [t.id, t.sectionId, seats],
    );
    return id as string;
  }

  async function mkList(
    t: Tenant,
    intakeId: string,
    kind: 'MERIT' | 'WAITING',
    sequence: number,
    activatedAt: string | null,
    actBy: string | null,
  ) {
    const [{ id }] = await ds.query(
      `INSERT INTO admission_lists (tenant_id, intake_id, kind, sequence, order_by, capacity,
         act_by_date, activated_at, active)
       VALUES ($1, $2, $3, $4, 'SCORE', 10, $5, $6, $7) RETURNING id`,
      [t.id, intakeId, kind, sequence, actBy, activatedAt, activatedAt !== null],
    );
    return id as string;
  }

  async function mkMember(
    t: Tenant,
    intakeId: string,
    listId: string,
    status: string,
    position: number,
  ) {
    const [{ id }] = await ds.query(
      `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name,
         date_of_birth, gender, guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, 'Kid', '2035-01-01', 'MALE', 'Parent', $4, $5) RETURNING id`,
      [t.id, intakeId, `REF-${rand()}`, `017${Math.floor(Math.random() * 1e8)}`, status],
    );
    await ds.query(
      `INSERT INTO admission_list_members (tenant_id, list_id, applicant_id, position)
       VALUES ($1, $2, $3, $4)`,
      [t.id, listId, id, position],
    );
  }

  /** Merit list past its deadline with `offered` lapsed offers, plus a waiting list with one WAITING. */
  async function scenario(t: Tenant, seats: number, offered: number, waitingActivated = false) {
    const intakeId = await mkIntake(t, seats);
    const merit = await mkList(t, intakeId, 'MERIT', 1, '2043-02-20T00:00:00Z', '2043-03-01');
    for (let i = 0; i < offered; i++) await mkMember(t, intakeId, merit, 'OFFERED', i + 1);
    const waiting = await mkList(
      t,
      intakeId,
      'WAITING',
      1,
      waitingActivated ? '2043-03-02T00:00:00Z' : null,
      waitingActivated ? '2043-03-10' : null,
    );
    await mkMember(t, intakeId, waiting, 'WAITING', 1);
    return intakeId;
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), OfficeRulesModule],
    );
    ds = module.get(DataSource);
    rule = module.get(AdmissionListDeadlineRule);
    A = await mkTenant();
    B = await mkTenant();
  }, 60000);

  beforeEach(async () => {
    for (const t of [A, B]) {
      for (const table of [
        'admission_list_members',
        'admission_lists',
        'admission_applicants',
        'admission_intakes',
      ]) {
        await ds.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t.id]);
      }
    }
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('raises for OFFICE_STAFF + ADMIN when the deadline passed and seats are free (lapsed offers count as free)', async () => {
    const intakeId = await scenario(A, 3, 1);
    const findings = await rule.evaluate(ctx(A));
    expect(findings).toHaveLength(1);
    expect(findings[0].subject).toEqual({ type: 'admission_intake', id: intakeId });
    expect(findings[0].params).toMatchObject({ seats: 3, sequence: 1 });
    expect(findings[0].actionUrl).toBe(`/admissions/intakes/${intakeId}`);
    expect(findings[0].recipients.map((r) => r.userId).sort()).toEqual(
      [A.adminId, A.officeId].sort(),
    );
  });

  it('is silent when seats are full', async () => {
    const intakeId = await mkIntake(A, 1);
    const merit = await mkList(A, intakeId, 'MERIT', 1, '2043-02-20T00:00:00Z', '2043-03-01');
    await mkMember(A, intakeId, merit, 'ADMITTED', 1);
    const waiting = await mkList(A, intakeId, 'WAITING', 1, null, null);
    await mkMember(A, intakeId, waiting, 'WAITING', 1);
    expect(await rule.evaluate(ctx(A))).toEqual([]);
  });

  it('is silent when the next list is already active', async () => {
    await scenario(A, 3, 1, true);
    expect(await rule.evaluate(ctx(A))).toEqual([]);
  });

  it('is silent while the previous deadline is still ahead', async () => {
    const intakeId = await mkIntake(A, 3);
    const merit = await mkList(A, intakeId, 'MERIT', 1, '2043-03-01T00:00:00Z', '2043-03-05');
    await mkMember(A, intakeId, merit, 'OFFERED', 1);
    const waiting = await mkList(A, intakeId, 'WAITING', 1, null, null);
    await mkMember(A, intakeId, waiting, 'WAITING', 1);
    expect(await rule.evaluate(ctx(A))).toEqual([]);
  });

  it('does not leak across tenants', async () => {
    await scenario(A, 3, 1);
    expect(await rule.evaluate(ctx(B))).toEqual([]);
    expect(await rule.evaluate(ctx(A))).toHaveLength(1);
  });
});
