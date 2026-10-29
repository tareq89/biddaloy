/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { Student } from '../../../students/entities/student.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { ArrivalNoticeSubscription } from '../../../attendance/entities/arrival-notice-subscription.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { cellText, toCell } from '../../codec/cell-format';
import type { ImportContext } from '../../codec/tab-spec';
import { guardiansTab } from '../people/guardians.tab';
import { studentsTab } from '../people/students.tab';
import { arrivalNoticeSubscriptionsTab as tab } from './arrival-notice-subscriptions.tab';

/** Export -> delete -> recreate parents with NEW ids -> restore, on a real Postgres. */
describe('arrival_notice_subscriptions tab (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  const A = 'a8420000-0000-4000-8000-0000000000a1';
  const B = 'a8420000-0000-4000-8000-0000000000b1';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  async function seedTenant(id: string, slug: string, reg: string, phone: string) {
    await ds.query(`DELETE FROM schools WHERE id = $1`, [id]);
    await ds.getRepository(School).save({ id, name: slug, slug });
    const year = await ds.getRepository(AcademicYear).save({
      tenant_id: id,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
    } as any);
    const klass = await ds
      .getRepository(Class)
      .save({ tenant_id: id, name: 'Six', numeric_grade: 6, academic_year_id: year.id } as any);
    const section = await ds
      .getRepository(ClassSection)
      .save({ tenant_id: id, class_id: klass.id, section_name: 'A', capacity: null } as any);
    return makeFamily(id, section.id, reg, phone);
  }

  async function makeFamily(id: string, sectionId: string, reg: string, phone: string, roll = 1) {
    const student = await ds.getRepository(Student).save({
      tenant_id: id,
      full_name: 'Kid',
      registration_number: reg,
      roll_number: roll,
      class_section_id: sectionId,
    } as any);
    const guardian = await ds.getRepository(Guardian).save({
      tenant_id: id,
      full_name: 'Parent',
      relationship: 'Father',
      phone,
    } as any);
    return { student, guardian, sectionId };
  }

  async function exportCells(tenant: string) {
    const keyOf = new Map<string, Map<string, string>>();
    for (const t of [studentsTab, guardiansTab]) {
      const es = await t.load(tenant, ds.manager);
      keyOf.set(t.name, new Map(es.map((e: any) => [e.id, t.keyOf(e)])));
    }
    const ctx = { keyOf: (t: string, i: string) => keyOf.get(t)!.get(i)! };
    const subs = await tab.load(tenant, ds.manager);
    return subs.map((e) => {
      const row = tab.toRow(e, ctx);
      return Object.fromEntries(
        tab.columns.map((c) => {
          const cell = toCell(c.type, row[c.key]);
          return [c.key, cellText(cell === null ? '' : String(cell))];
        }),
      );
    });
  }

  it('restores rows onto re-created parents, ignoring other schools', async () => {
    const a = await seedTenant(A, 'arrival-a-8420', 'ARR-A1', '01800000001');
    const b = await seedTenant(B, 'arrival-b-8420', 'ARR-B1', '01800000002');
    const subRepo = ds.getRepository(ArrivalNoticeSubscription);
    await subRepo.save({
      tenant_id: A,
      student_id: a.student.id,
      guardian_id: a.guardian.id,
      status: 'OFF',
      mode: 'ONCE',
      channel: 'SMS',
      lock: 'NEVER',
      consumed_at: new Date('2026-05-01T09:00:00.000Z'),
    } as any);
    await subRepo.save({
      tenant_id: B,
      student_id: b.student.id,
      guardian_id: b.guardian.id,
    } as any);

    const cells = await exportCells(A);
    // Tenant isolation: only school A's single row is exported.
    expect(cells).toHaveLength(1);

    // Wipe school A's subscription and parents, then re-create parents with new ids.
    await ds.query(`DELETE FROM arrival_notice_subscriptions WHERE tenant_id = $1`, [A]);
    await ds.query(`DELETE FROM students WHERE tenant_id = $1`, [A]);
    await ds.query(`DELETE FROM guardians WHERE tenant_id = $1`, [A]);
    const again = await makeFamily(A, a.sectionId, 'ARR-A1', '01800000001');
    expect(again.student.id).not.toBe(a.student.id);

    const ids: Record<string, Record<string, string>> = {
      students: { 'ARR-A1': again.student.id },
      guardians: { '01800000001': again.guardian.id },
    };
    const ctx: ImportContext = {
      tenantId: A,
      ref: (t, k) => ids[t]?.[k],
      warn: () => undefined,
    };
    const res = tab.fromRow(cells[0], 2, ctx);
    if ('errors' in res) throw new Error(JSON.stringify(res.errors));
    await tab.upsert(res.row, null, A, ds.manager);

    const restored = await subRepo.find({ where: { tenant_id: A } });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      student_id: again.student.id,
      guardian_id: again.guardian.id,
      status: 'OFF',
      mode: 'ONCE',
      channel: 'SMS',
      lock: 'NEVER',
    });
    expect(restored[0].consumed_at?.toISOString()).toBe('2026-05-01T09:00:00.000Z');
    // School B untouched.
    expect(await subRepo.count({ where: { tenant_id: B } })).toBe(1);
  });

  it('leaves out rows whose student or guardian is soft-deleted, instead of failing', async () => {
    const a = await seedTenant(A, 'arrival-a-8420', 'ARR-A2', '01800000003');
    const kidGone = await makeFamily(A, a.sectionId, 'ARR-A3', '01800000004', 2);
    const parentGone = await makeFamily(A, a.sectionId, 'ARR-A4', '01800000005', 3);
    const subRepo = ds.getRepository(ArrivalNoticeSubscription);
    for (const f of [a, kidGone, parentGone]) {
      await subRepo.save({
        tenant_id: A,
        student_id: f.student.id,
        guardian_id: f.guardian.id,
      } as any);
    }
    await ds.getRepository(Student).softDelete({ id: kidGone.student.id });
    await ds.getRepository(Guardian).softDelete({ id: parentGone.guardian.id });

    const cells = await exportCells(A);
    expect(cells.map((c) => c.student)).toEqual(['ARR-A2']);
  });

  it('reports a row whose student is missing instead of inserting it', () => {
    const res = tab.fromRow(
      {
        id: '11111111-1111-4111-8111-111111111111',
        student: 'GONE',
        guardian: '01800000001',
        status: 'REQUESTED',
        mode: 'RECURRING',
        channel: 'PUSH',
        lock: 'NONE',
      },
      2,
      { tenantId: A, ref: (t) => (t === 'guardians' ? 'g' : undefined), warn: () => undefined },
    );
    expect('errors' in res && res.errors[0].column).toBe('student');
  });
});
