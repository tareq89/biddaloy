import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { ApplicationStatus, ApplicationType, ApprovalScope } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { ApplicationsModule } from '../applications.module';
import { AuthModule } from '../../auth/auth.module';
import { FeeWaiverHandler } from './fee-waiver.handler';
import { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { DiscountRulesService } from '../../fees/discount-rules.service';
import { DiscountRule } from '../../fees/entities/discount-rule.entity';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { Student } from '../../students/entities/student.entity';

/**
 * [52.3.4] FEE_WAIVER handler against a real DB with the real DiscountRulesService.
 * Only the step-up token check is stubbed. Calls run inside `dataSource.transaction`,
 * as the decision service will.
 */
describe('FeeWaiverHandler (integration)', () => {
  let handler: FeeWaiverHandler;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000096';
  const APPROVER_ID = SEED_ADMIN_USER_ID;
  const ctx = (extra: Partial<ApplicationEffectContext> = {}) =>
    ({
      tenantId: TENANT_ID,
      actorUserId: SEED_ADMIN_USER_ID,
      req: {},
      ...extra,
    }) as ApplicationEffectContext;
  let studentId: string;
  let serial = 0;
  let tokenPresent = true;

  const run = <T>(fn: (m: EntityManager) => Promise<T>) => dataSource.transaction(fn);
  const rulesFor = () =>
    dataSource.getRepository(DiscountRule).find({ where: { student_id: studentId } });
  const auditCount = (entityId: string) =>
    dataSource.getRepository(AuditLog).count({
      where: { entity_type: 'DiscountRule', entity_id: entityId },
    });

  const makeApp = (payload: Record<string, unknown> = {}) =>
    dataSource.getRepository(Application).save({
      tenant_id: TENANT_ID,
      type: ApplicationType.FEE_WAIVER,
      status: ApplicationStatus.PENDING,
      serial_year: 2026,
      serial_no: ++serial,
      applicant_user_id: SEED_ADMIN_USER_ID,
      subject_student_id: studentId,
      payload: {
        kind: 'PERCENT',
        value: 50,
        fee_types: ['MONTHLY_TUITION'],
        start_date: '2026-11-01',
        end_date: '2027-03-31',
        reason: 'Family hardship',
        ...payload,
      },
      letter_text: 'x',
      letter_locale: 'en',
    });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    // Real DiscountRulesService; only the token check is replaced.
    const approvalStub = {
      consume: async (_req: unknown, scope: ApprovalScope) => {
        if (!tokenPresent) throw new ApprovalRequiredException(scope);
        return { approverId: APPROVER_ID, scope, jti: 'jti-1' };
      },
    };
    handler = new FeeWaiverHandler(approvalStub as any, module.get(DiscountRulesService));

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School FW', slug: 'other-school-fw' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    tokenPresent = true;
    await dataSource.query(`DELETE FROM applications WHERE tenant_id = $1`, [TENANT_ID]);
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `FW Year ${Date.now()}`,
      start_date: '2020-01-01',
      end_date: '2040-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'FW Class', academic_year_id: year.id, tenant_id: TENANT_ID });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'FW Sec', class_id: klass.id, tenant_id: TENANT_ID });
    studentId = (
      await dataSource.getRepository(Student).save({
        full_name: 'Waiver Student',
        registration_number: `FW-${Date.now()}-${Math.random()}`,
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: TENANT_ID,
      })
    ).id;
  });

  it('no approval token: 403 APPROVAL_REQUIRED, nothing written', async () => {
    tokenPresent = false;
    const app = await makeApp();
    const auditBefore = await dataSource
      .getRepository(AuditLog)
      .count({ where: { entity_type: 'DiscountRule' } });
    const err = await run((m) => handler.apply(m, app, ctx())).catch((e) => e);

    expect(err).toBeInstanceOf(ApprovalRequiredException);
    expect(err.getResponse()).toEqual({
      details: { code: 'APPROVAL_REQUIRED', scope: 'discount_rules.manage' },
    });
    expect(await rulesFor()).toHaveLength(0);
    expect(
      await dataSource.getRepository(AuditLog).count({ where: { entity_type: 'DiscountRule' } }),
    ).toBe(auditBefore);
  });

  it('token, no granted: rule matches the requested payload; audit row carries the approver', async () => {
    const app = await makeApp();
    const res = await run((m) => handler.apply(m, app, ctx()));

    const [rule] = await rulesFor();
    expect(res).toEqual({
      discount_rule_id: rule.id,
      kind: 'PERCENT',
      value: 50,
      approved_by_user_id: APPROVER_ID,
    });
    expect(rule).toMatchObject({
      tenant_id: TENANT_ID,
      kind: 'PERCENT',
      fee_types: ['MONTHLY_TUITION'],
      starts_on: '2026-11-01',
      ends_on: '2027-03-31',
      approved_by_user_id: APPROVER_ID,
      created_by_user_id: SEED_ADMIN_USER_ID,
    });
    expect(Number(rule.value)).toBe(50);
    expect(rule.reason).toBe(
      `Application 2026/${String(app.serial_no).padStart(4, '0')}: Family hardship`,
    );
    // Money path: the approved-audit row must name the approver and the scope.
    const audit = await dataSource
      .getRepository(AuditLog)
      .findOneByOrFail({ entity_type: 'DiscountRule', entity_id: rule.id });
    expect(audit.new_values).toMatchObject({
      approved_by_user_id: APPROVER_ID,
      approval_scope: 'discount_rules.manage',
    });
  });

  it('granted terms drive the rule; omitted fields keep the requested value; payload untouched', async () => {
    const app = await makeApp();
    await run((m) => handler.apply(m, app, ctx({ granted: { kind: 'FLAT', value: 500 } })));
    const [rule] = await rulesFor();
    expect(rule.kind).toBe('FLAT');
    expect(Number(rule.value)).toBe(500);
    expect(rule.fee_types).toEqual(['MONTHLY_TUITION']);
    expect(rule.starts_on).toBe('2026-11-01');
    expect(rule.ends_on).toBe('2027-03-31');
    expect(app.payload).toMatchObject({ kind: 'PERCENT', value: 50 });
  });

  it('granted fee_types and dates override the requested ones', async () => {
    const app = await makeApp();
    await run((m) =>
      handler.apply(
        m,
        app,
        ctx({
          granted: {
            kind: 'PERCENT',
            value: 25,
            fee_types: ['EXAM_FEE'],
            start_date: '2026-12-01',
            end_date: '2027-01-31',
          },
        }),
      ),
    );
    const [rule] = await rulesFor();
    expect(Number(rule.value)).toBe(25);
    expect(rule.fee_types).toEqual(['EXAM_FEE']);
    expect(rule.starts_on).toBe('2026-12-01');
    expect(rule.ends_on).toBe('2027-01-31');
  });

  it('datetime-string dates are cut to the date part', async () => {
    const app = await makeApp({
      start_date: '2026-11-01T00:00:00.000Z',
      end_date: '2027-03-31T23:59:59.000Z',
    });
    await run((m) => handler.apply(m, app, ctx()));
    const [rule] = await rulesFor();
    expect(rule.starts_on).toBe('2026-11-01');
    expect(rule.ends_on).toBe('2027-03-31');
  });

  // Every invalid input must be a 422 INVALID_GRANTED and leave nothing behind.
  async function expectInvalid(
    granted: Record<string, unknown>,
    payload: Record<string, unknown> = {},
  ) {
    const app = await makeApp(payload);
    const err = await run((m) => handler.apply(m, app, ctx({ granted }))).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toMatchObject({ details: { code: 'INVALID_GRANTED' } });
    expect(await rulesFor()).toHaveLength(0);
  }

  it('PERCENT over 100 is refused', () => expectInvalid({ kind: 'PERCENT', value: 150 }));
  it('negative value is refused', () => expectInvalid({ kind: 'FLAT', value: -1 }));
  it('zero value is refused', () => expectInvalid({ kind: 'FLAT', value: 0 }));
  it('non-finite value is refused', () => expectInvalid({ kind: 'FLAT', value: Infinity }));
  it('string value is refused', () => expectInvalid({ kind: 'FLAT', value: '500' }));
  it('more than 2 decimals is refused', () => expectInvalid({ kind: 'FLAT', value: 10.123 }));
  it('unknown kind is refused', () => expectInvalid({ kind: 'FREE', value: 5 }));
  it('empty fee_types is refused', () => expectInvalid({ fee_types: [] }));
  it('unknown fee type is refused', () => expectInvalid({ fee_types: ['NOT_A_FEE'] }));
  it('malformed date is refused', () => expectInvalid({ start_date: '01/11/2026' }));
  it('impossible date is refused, not a DB 500', () => expectInvalid({ end_date: '2026-02-30' }));

  it('application without a student is refused', async () => {
    const app = await makeApp();
    app.subject_student_id = null as any;
    const err = await run((m) => handler.apply(m, app, ctx())).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(await rulesFor()).toHaveLength(0);
  });

  it('long reason is cut to 200 chars and keeps the serial prefix', async () => {
    const app = await makeApp({ reason: 'x'.repeat(300) });
    await run((m) => handler.apply(m, app, ctx()));
    const [rule] = await rulesFor();
    expect(rule.reason).toHaveLength(200);
    expect(rule.reason.startsWith('Application 2026/')).toBe(true);
  });

  it('created rule is visible on the same manager before commit; rollback leaves no rule and no audit row', async () => {
    const app = await makeApp();
    let ruleId = '';
    const err = await run(async (m) => {
      const res = await handler.apply(m, app, ctx());
      ruleId = res!.discount_rule_id as string;
      // Same transaction sees it...
      expect(await m.getRepository(DiscountRule).count({ where: { id: ruleId } })).toBe(1);
      // ...another connection does not (proves the handler used our manager).
      expect(await dataSource.getRepository(DiscountRule).count({ where: { id: ruleId } })).toBe(0);
      throw new Error('rollback');
    }).catch((e) => e);

    // Proves the inner expects ran: the only way out is our own throw.
    expect(err.message).toBe('rollback');
    expect(ruleId).not.toBe('');
    expect(await rulesFor()).toHaveLength(0);
    expect(await auditCount(ruleId)).toBe(0);
  });

  it('tenant isolation: another tenant cannot waive a student it does not own', async () => {
    const app = await makeApp();
    const err = await run((m) => handler.apply(m, app, ctx({ tenantId: OTHER_TENANT }))).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(await rulesFor()).toHaveLength(0);
    expect(
      await dataSource.getRepository(DiscountRule).count({ where: { tenant_id: OTHER_TENANT } }),
    ).toBe(0);
  });
});
