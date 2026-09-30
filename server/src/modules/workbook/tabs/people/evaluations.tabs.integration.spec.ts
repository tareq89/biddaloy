import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { TeacherDesignation, UserRole } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { AcrFormVersion } from '../../../acr/entities/acr-form-version.entity';
import { AcrCriterion } from '../../../acr/entities/acr-criterion.entity';
import { AcrAssessment } from '../../../acr/entities/acr-assessment.entity';
import { AcrScore } from '../../../acr/entities/acr-score.entity';
import { StaffIncident } from '../../../incidents/entities/staff-incident.entity';
import { Survey } from '../../../surveys/entities/survey.entity';
import { SurveyQuestion } from '../../../surveys/entities/survey-question.entity';
import { SurveyTarget } from '../../../surveys/entities/survey-target.entity';
import { SurveyResponse } from '../../../surveys/entities/survey-response.entity';
import { SurveyAnswer } from '../../../surveys/entities/survey-answer.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { cellText, toCell } from '../../codec/cell-format';
import type { ImportContext, TabSpec } from '../../codec/tab-spec';
import { academicYearsTab } from '../academics/academic-years.tab';
import { subjectsTab } from '../academics/subjects.tab';
import { acrTabs } from './acr.tab';
import { incidentsTabs } from './incidents.tab';
import { surveysTabs } from './surveys.tab';
import { teachersTab } from './teachers.tab';
import { usersTab } from './users.tab';

/**
 * Export -> wipe -> restore -> re-export for Epic 28.0's ten tables, against
 * a real Postgres. What the unit specs cannot show: the real `load()` key
 * stamping, jsonb / smallint / timestamptz columns, and `created_at` inside
 * natural keys.
 *
 * Also pins a deliberate rule: a row whose author is a SUPER_ADMIN-only user
 * (who `usersTab.load` never exports) is left out of the export, together
 * with its children, rather than written with a blank ref that would abort
 * the restore.
 */
describe('ACR / incidents / surveys tabs (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;

  const TENANT = 'a1228000-0000-4000-8000-000000000001';
  const EMAIL = 'eval-staff@evaltabs.test';
  const ADMIN_EMAIL = 'eval-super@evaltabs.test';

  // Parents first, then the ten new tabs in restore order.
  const parentTabs = [usersTab, academicYearsTab, subjectsTab, teachersTab] as TabSpec<any, any>[];
  const tabs = [...acrTabs, ...incidentsTabs, ...surveysTabs] as TabSpec<any, any>[];

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  /** What export.processor does: load, key-map, toRow, cell-format. Returns cells + key maps. */
  async function exportAll() {
    const keyMaps = new Map<string, Map<string, string>>();
    const sheets = new Map<string, Record<string, string>[]>();
    for (const tab of [...parentTabs, ...tabs]) {
      const entities = await tab.load(TENANT, ds.manager);
      keyMaps.set(tab.name, new Map(entities.map((e: any) => [e.id, tab.keyOf(e)])));
      const ctx = {
        keyOf: (t: string, id: string) => {
          const k = keyMaps.get(t)?.get(id);
          if (k === undefined) throw new Error(`no key for ${t} ${id}`);
          return k;
        },
      };
      sheets.set(
        tab.name,
        entities.map((e: any) => {
          const row = tab.toRow(e, ctx);
          return Object.fromEntries(
            tab.columns.map((c) => {
              const cell = toCell(c.type, row[c.key]);
              return [c.key, cellText(cell === null ? '' : String(cell))];
            }),
          );
        }),
      );
    }
    return { keyMaps, sheets };
  }

  async function seed() {
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT]);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@evaltabs.test'`);
    await ds.getRepository(School).save({ id: TENANT, name: 'Eval School', slug: 'eval-tabs-1228' });

    const mkUser = async (email: string, role: UserRole) => {
      const u = await ds.getRepository(User).save(
        ds.getRepository(User).create({ email, phone: null, full_name: email, password_hash: null }),
      );
      await ds.getRepository(UserTenant).save({ user_id: u.id, tenant_id: TENANT, role, metadata: null });
      return u;
    };
    const staff = await mkUser(EMAIL, UserRole.TEACHER);
    const admin = await mkUser(ADMIN_EMAIL, UserRole.SUPER_ADMIN);

    const year = await ds.getRepository(AcademicYear).save({
      tenant_id: TENANT,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
    } as never);
    const subject = await ds
      .getRepository(Subject)
      .save({ tenant_id: TENANT, name_en: 'Maths', code: 'MATH-1228', is_active: true } as never);
    const teacher = await teachersTab.upsert(
      {
        id: '00000000-0000-4000-8000-000000000000',
        user_id: staff.id,
        employee_id: 'EMP-1228',
        designations: [TeacherDesignation.CLASS_TEACHER],
        subject_specialization: null,
        joining_date: null,
        user_key: '',
      },
      null,
      TENANT,
      ds.manager,
    );

    const version = await ds
      .getRepository(AcrFormVersion)
      .save({ tenant_id: TENANT, version: 1, created_by: staff.id });
    const criterion = await ds.getRepository(AcrCriterion).save({
      tenant_id: TENANT,
      form_version_id: version.id,
      block: 'BLOCK_2',
      code: 'T1',
      label_en: 'Punctuality',
      label_bn: 'সময়ানুবর্তিতা',
      sort_order: 1,
    });
    const assessment = await ds.getRepository(AcrAssessment).save({
      tenant_id: TENANT,
      user_id: staff.id,
      academic_year_id: year.id,
      form_version_id: version.id,
      assessed_by: staff.id,
      status: 'COMPLETED',
      total: 3,
      step1_data: { b: 1, a: { y: 2, x: 1 } },
      step3_data: null,
      completed_at: new Date('2026-06-01T10:00:00.000Z'),
    });
    await ds
      .getRepository(AcrScore)
      .save({ tenant_id: TENANT, assessment_id: assessment.id, criterion_id: criterion.id, score: 3 });

    const incidents = ds.getRepository(StaffIncident);
    await incidents.save({
      tenant_id: TENANT,
      staff_user_id: staff.id,
      reported_by: staff.id,
      type: 'OTHER',
      severity: 'LOW',
      body: 'Kept',
      occurred_on: '2026-04-02',
    });
    // Reported by a SUPER_ADMIN-only user: must be omitted from the export.
    await incidents.save({
      tenant_id: TENANT,
      staff_user_id: staff.id,
      reported_by: admin.id,
      type: 'OTHER',
      severity: 'HIGH',
      body: 'Platform-reported',
      occurred_on: '2026-04-03',
    });

    const survey = await ds.getRepository(Survey).save({
      tenant_id: TENANT,
      title: 'Term 1',
      status: 'OPEN',
      anonymous: true,
      respondent: 'BOTH',
      opens_at: null,
      closes_at: new Date('2026-07-01T00:00:00.000Z'),
      min_responses: 5,
    });
    const question = await ds
      .getRepository(SurveyQuestion)
      .save({ tenant_id: TENANT, survey_id: survey.id, sort_order: 1, text: 'Clear?', stars_enabled: true });
    await ds
      .getRepository(SurveyTarget)
      .save({ tenant_id: TENANT, survey_id: survey.id, teacher_id: teacher.id, subject_id: subject.id });
    const response = await ds.getRepository(SurveyResponse).save({
      tenant_id: TENANT,
      survey_id: survey.id,
      respondent_user_id: staff.id,
      teacher_id: teacher.id,
      subject_id: subject.id,
    });
    await ds
      .getRepository(SurveyAnswer)
      .save({ tenant_id: TENANT, response_id: response.id, question_id: question.id, text: 'Yes', stars: 5 });
    return staff;
  }

  it('exports, restores into emptied tables, and re-exports identical sheets', async () => {
    await seed();
    const first = await exportAll();

    expect(first.sheets.get('staff_incidents')).toHaveLength(1); // SUPER_ADMIN-reported one omitted
    expect(first.sheets.get('acr_scores')).toHaveLength(1);
    expect(first.sheets.get('survey_answers')).toHaveLength(1);

    // Wipe the ten tables for this tenant (children first).
    for (const t of [...tabs].reverse()) {
      await ds.query(`DELETE FROM ${ds.getMetadata(t.entity).tableName} WHERE tenant_id = $1`, [TENANT]);
    }

    // Restore in order, resolving refs from the first export's key maps.
    const ctx: ImportContext = {
      tenantId: TENANT,
      ref: (t, key) => [...(first.keyMaps.get(t) ?? [])].find(([, k]) => k === key)?.[0],
      warn: () => undefined,
    };
    for (const tab of tabs) {
      // Restore assigns fresh ids (the tabs do not reuse the row id), so a
      // tab's children must resolve against the new ids, not the exported ones.
      const restored = new Map<string, string>();
      for (const [i, cells] of first.sheets.get(tab.name)!.entries()) {
        const res = tab.fromRow(cells, i + 2, ctx);
        if ('errors' in res) throw new Error(JSON.stringify(res.errors));
        const saved = await tab.upsert(res.row, null, TENANT, ds.manager);
        restored.set(saved.id, tab.keyOf(res.row));
      }
      first.keyMaps.set(tab.name, restored);
    }

    const second = await exportAll();
    for (const tab of tabs) {
      // `id` is excluded: restore inserts fresh ids (as every tab's upsert does).
      const withoutId = (rows?: Record<string, string>[]) =>
        rows?.map(({ id: _id, ...rest }) => rest);
      expect(withoutId(second.sheets.get(tab.name)), tab.name).toEqual(
        withoutId(first.sheets.get(tab.name)),
      );
    }
    const assessment = await ds.getRepository(AcrAssessment).findOneByOrFail({ tenant_id: TENANT });
    expect(assessment.total).toBe(3);
    expect(assessment.step1_data).toEqual({ a: { x: 1, y: 2 }, b: 1 });
  });
});
