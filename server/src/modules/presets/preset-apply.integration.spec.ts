import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { ExamTemplate } from '../exams/entities/exam-template.entity';
import { PresetApplyService } from './preset-apply.service';
import { PresetRegistryService } from './preset-registry.service';
import { makeTestPack } from './__fixtures__/test-pack';

const RESULT_KEYS = [
  'academicTerms',
  'academicYears',
  'classSubjects',
  'classes',
  'examTemplateComponents',
  'examTemplates',
  'gradingBands',
  'gradingScales',
  'settings',
  'subjects',
];

describe('PresetApplyService (integration)', () => {
  let ds: DataSource;
  let svc: PresetApplyService;
  let registry: PresetRegistryService;
  let audit: AuditService;
  let uid: string;
  const cache = { invalidate: vi.fn() };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      { provide: TenantSettingsCache, useValue: cache },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PresetApplyService);
    registry = module.get(PresetRegistryService);
    audit = module.get(AuditService);
    uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `apply-${uid}@example.com`,
      password_hash: 'x',
      full_name: 'Apply Admin',
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      name: 'Apply School',
      slug: `apply-${id}`,
      settings: { version: 1 } as never,
    });
    return id;
  };
  const dto = { preset_id: 'test/pack', start_year: 2026, stages: ['PRIMARY', 'SECONDARY'] };
  const rows = async (tenant_id: string) => ({
    classes: await ds.getRepository(Class).countBy({ tenant_id }),
    years: await ds.getRepository(AcademicYear).countBy({ tenant_id }),
    subjects: await ds.getRepository(Subject).countBy({ tenant_id }),
    scales: await ds.getRepository(GradingScale).countBy({ tenant_id }),
    templates: await ds.getRepository(ExamTemplate).countBy({ tenant_id }),
    audits: await ds.getRepository(AuditLog).countBy({ tenant_id }),
  });
  const presetOf = async (id: string) =>
    ((await ds.getRepository(School).findOneByOrFail({ id })).settings as any)?.preset;

  it('fresh tenant: exact counts, exact key set, preset block, one audit row, cache evicted; tenant B untouched', async () => {
    registry.packs = [makeTestPack()];
    const a = await newSchool();
    const b = await newSchool();
    const bBefore = (await ds.getRepository(School).findOneByOrFail({ id: b })).settings;
    cache.invalidate.mockClear();

    const { created } = await svc.apply(a, uid, dto);

    expect(Object.keys(created).sort()).toEqual(RESULT_KEYS);
    expect(created).toMatchObject({
      settings: 1,
      academicYears: 1,
      classes: 3,
      subjects: 4,
      classSubjects: 4,
      academicTerms: 1,
      gradingScales: 1,
      gradingBands: 3,
      examTemplates: 1,
      examTemplateComponents: 1,
    });
    expect((await presetOf(a)).id).toBe('test/pack');
    expect(await rows(a)).toMatchObject({ classes: 3, years: 1, audits: 1 });
    const log = await ds.getRepository(AuditLog).findOneByOrFail({ tenant_id: a });
    expect(log).toMatchObject({ entity_type: 'CurriculumPreset', entity_id: a });
    expect(cache.invalidate).toHaveBeenCalledWith(a);

    expect(await rows(b)).toEqual({
      classes: 0,
      years: 0,
      subjects: 0,
      scales: 0,
      templates: 0,
      audits: 0,
    });
    expect((await ds.getRepository(School).findOneByOrFail({ id: b })).settings).toEqual(bBefore);
  });

  it('second apply and a school with a manual year are refused', async () => {
    registry.packs = [makeTestPack()];
    const a = await newSchool();
    await svc.apply(a, uid, dto);
    await expect(svc.apply(a, uid, dto)).rejects.toBeInstanceOf(ConflictException);

    const c = await newSchool();
    await ds.getRepository(AcademicYear).save({
      tenant_id: c,
      name: 'Manual',
      start_date: new Date(2025, 0, 1),
      end_date: new Date(2025, 11, 31),
      is_current: true,
    } as never);
    const err = await svc.apply(c, uid, dto).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'PRESET_NOT_FRESH' });
    expect(await presetOf(c)).toBeUndefined();
  });

  it('writer failure mid-way rolls everything back: no rows, no preset, no audit, no cache evict', async () => {
    const pack = makeTestPack();
    pack.gradingScale!.bands[1].from = 10; // overlaps the first band -> grading writer throws after classes/subjects
    registry.packs = [pack];
    const t = await newSchool();
    cache.invalidate.mockClear();

    await expect(svc.apply(t, uid, dto)).rejects.toThrow();

    expect(await rows(t)).toEqual({
      classes: 0,
      years: 0,
      subjects: 0,
      scales: 0,
      templates: 0,
      audits: 0,
    });
    expect(await presetOf(t)).toBeUndefined();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('audit failure after all writers also rolls everything back', async () => {
    registry.packs = [makeTestPack()];
    const t = await newSchool();
    const spy = vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.apply(t, uid, dto)).rejects.toThrow('audit down');
    spy.mockRestore();
    expect(await rows(t)).toEqual({
      classes: 0,
      years: 0,
      subjects: 0,
      scales: 0,
      templates: 0,
      audits: 0,
    });
    expect(await presetOf(t)).toBeUndefined();
  });

  it('two concurrent applies: exactly one succeeds (school row lock)', async () => {
    registry.packs = [makeTestPack()];
    const t = await newSchool();
    const results = await Promise.allSettled([svc.apply(t, uid, dto), svc.apply(t, uid, dto)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect(await rows(t)).toMatchObject({ classes: 3, years: 1, audits: 1 });
  });
});
