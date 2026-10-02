import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { GradingBand } from '../grading/entities/grading-band.entity';
import { ExamTemplate } from '../exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../exams/entities/exam-template-component.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { PresetApplyService } from './preset-apply.service';
import { PresetResetService } from './preset-reset.service';
import { PresetRegistryService } from './preset-registry.service';
import { RESET_BLOCKER_ENTITIES } from './preset-blockers';
import { makeTestPack } from './__fixtures__/test-pack';

describe('PresetResetService (integration)', () => {
  let ds: DataSource;
  let apply: PresetApplyService;
  let reset: PresetResetService;
  let registry: PresetRegistryService;
  let audit: AuditService;
  let uid: string;
  const cache = { invalidate: vi.fn() };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetResetService,
      PresetRegistryService,
      AuditService,
      { provide: TenantSettingsCache, useValue: cache },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    apply = module.get(PresetApplyService);
    reset = module.get(PresetResetService);
    registry = module.get(PresetRegistryService);
    audit = module.get(AuditService);
    registry.packs = [makeTestPack()];
    uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `reset-${uid}@example.com`,
      password_hash: 'x',
      full_name: 'Reset Admin',
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const dto = { preset_id: 'test/pack', start_year: 2026, stages: ['PRIMARY', 'SECONDARY'] };
  const why = { reason: 'applied the wrong curriculum' };
  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      name: 'Reset School',
      slug: `reset-${id}`,
      settings: { version: 1 } as never,
    });
    return id;
  };
  const appliedSchool = async () => {
    const id = await newSchool();
    await apply.apply(id, uid, dto);
    return id;
  };
  const rows = async (tenant_id: string) => ({
    classes: await ds.getRepository(Class).countBy({ tenant_id }),
    years: await ds.getRepository(AcademicYear).countBy({ tenant_id }),
    subjects: await ds.getRepository(Subject).countBy({ tenant_id }),
    scales: await ds.getRepository(GradingScale).countBy({ tenant_id }),
    bands: await ds.getRepository(GradingBand).countBy({ tenant_id }),
    templates: await ds.getRepository(ExamTemplate).countBy({ tenant_id }),
    components: await ds.getRepository(ExamTemplateComponent).countBy({ tenant_id }),
    terms: await ds.getRepository(AcademicTerm).countBy({ tenant_id }),
  });
  const settingsOf = async (id: string) =>
    (await ds.getRepository(School).findOneByOrFail({ id })).settings as any;

  it('reset wipes the tenant, clears preset, audits with the reason; tenant B untouched; re-apply works', async () => {
    const a = await appliedSchool();
    const b = await appliedSchool();
    const bRows = await rows(b);
    const bSettings = await settingsOf(b);
    expect(bRows.classes).toBeGreaterThan(0);
    cache.invalidate.mockClear();

    const { deleted } = await reset.reset(a, uid, why);

    expect(deleted).toMatchObject({ classes: 3, academicYears: 1, examTemplateComponents: 1 });
    expect(Object.values(await rows(a)).every((n) => n === 0)).toBe(true);
    const s = await settingsOf(a);
    expect(s.preset).toBeUndefined();
    expect(s.organisation).toBeDefined();
    const log = await ds
      .getRepository(AuditLog)
      .findOneByOrFail({ tenant_id: a, action: 'DELETE' as never });
    expect(log).toMatchObject({
      entity_type: 'CurriculumPreset',
      entity_id: a,
      performed_by_user_id: uid,
      new_values: { reason: why.reason },
    });
    expect((log.old_values as any).preset.id).toBe('test/pack');
    expect(cache.invalidate).toHaveBeenCalledWith(a);

    // tenant B: rows and settings.preset identical
    expect(await rows(b)).toEqual(bRows);
    expect(await settingsOf(b)).toEqual(bSettings);
    expect(bSettings.preset.id).toBe('test/pack');

    // partial unique indexes are free again
    await expect(apply.apply(a, uid, dto)).resolves.toBeDefined();
    expect((await rows(a)).classes).toBe(3);
  });

  it('refused when no preset applied; 404 unknown school', async () => {
    const t = await newSchool();
    const err = await reset.reset(t, uid, why).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'PRESET_NOT_APPLIED' });
    await expect(reset.reset(randomUUID(), uid, why)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refused once a student exists: nothing deleted, preset kept', async () => {
    const t = await appliedSchool();
    const cls = await ds.getRepository(Class).findOneByOrFail({ tenant_id: t });
    const section = await ds
      .getRepository(ClassSection)
      .save({ tenant_id: t, class_id: cls.id, section_name: 'A' } as never);
    await ds.getRepository(Student).save({
      tenant_id: t,
      full_name: 'Blocker Kid',
      registration_number: `R-${t}`,
      roll_number: 1,
      class_section_id: section.id,
    } as never);
    const before = await rows(t);
    const err = await reset.reset(t, uid, why).catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      code: 'PRESET_RESET_BLOCKED',
      blockers: [{ entity: 'students', count: 1 }],
    });
    expect(await rows(t)).toEqual(before);
    expect((await settingsOf(t)).preset).toBeDefined();
  });

  it('audit failure rolls the whole reset back (fails if the transaction is removed)', async () => {
    const t = await appliedSchool();
    const before = await rows(t);
    cache.invalidate.mockClear();
    const spy = vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit down'));
    await expect(reset.reset(t, uid, why)).rejects.toThrow('audit down');
    spy.mockRestore();
    expect(await rows(t)).toEqual(before);
    expect((await settingsOf(t)).preset).toBeDefined();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('blocker list covers the decided extra entities', () => {
    const labels = RESET_BLOCKER_ENTITIES.map((b) => b.label);
    for (const l of [
      'teacher assignments',
      'routines',
      'admission intakes',
      'recurring fee schedules',
      'fine rules',
    ])
      expect(labels).toContain(l);
  });
});
