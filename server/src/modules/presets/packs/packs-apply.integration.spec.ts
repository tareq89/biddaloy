import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../../schools/settings/tenant-settings-defaults';
import { Class } from '../../academics/entities/class.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { ClassSubject } from '../../academics/entities/class-subject.entity';
import { PresetApplyService } from '../preset-apply.service';
import { PresetRegistryService } from '../preset-registry.service';
import { PRESET_PACKS } from './index';

describe('every registered pack applies to a fresh tenant (integration)', () => {
  let ds: DataSource;
  let svc: PresetApplyService;
  let registry: PresetRegistryService;
  let uid: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PresetApplyService);
    registry = module.get(PresetRegistryService);
    uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `packs-${uid}@example.com`,
      password_hash: 'x',
      full_name: 'Packs Admin',
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      name: 'Pack School',
      slug: `pack-${id}`,
      settings: { version: 1 } as never,
    });
    return id;
  };
  const settingsOf = async (id: string) =>
    (await ds.getRepository(School).findOneByOrFail({ id })).settings as any;
  const csRows = (tenant_id: string) =>
    ds
      .getRepository(ClassSubject)
      .createQueryBuilder('cs')
      .innerJoinAndSelect('cs.class', 'c')
      .innerJoinAndSelect('cs.subject', 's')
      .where('cs.tenant_id = :tenant_id', { tenant_id })
      .getMany();

  it('registry boots with all five packs', () => {
    expect(() => registry.onModuleInit()).not.toThrow();
    expect(registry.list().map((p) => p.id)).toEqual(PRESET_PACKS.map((p) => p.id));
  });

  it.each(PRESET_PACKS.map((p) => [p.id, p] as const))('%s applies with all stages', async (_id, pack) => {
    const t = await newSchool();
    const { created } = await svc.apply(t, uid, {
      preset_id: pack.id,
      start_year: 2026,
      stages: pack.stages.map((s) => s.key),
      versions: pack.versions?.map((v) => v.key) ?? [],
    });
    expect(Object.values(created).some((n) => n > 0)).toBe(true);
    if (pack.id !== 'blank') expect(created.classes).toBeGreaterThan(0);
    else expect(created).toMatchObject({ academicYears: 1, classes: 0, subjects: 0, classSubjects: 0 });

    const settings = await settingsOf(t);
    expect(settings.preset).toMatchObject({ id: pack.id, version: pack.version });
    expect(await ds.getRepository(AcademicYear).countBy({ tenant_id: t, is_current: true })).toBe(1);
    // Weekly-off is not part of apply: every tenant keeps the Friday default (see packs README note).
    expect(settings.attendance?.weeklyOffDays ?? DEFAULT_ATTENDANCE_SETTINGS.weeklyOffDays).toEqual([5]);

    const byGroup = new Map<string, number>();
    for (const cs of await csRows(t)) {
      if (cs.choice_group === null) continue;
      expect(cs.is_optional).toBe(false);
      expect(cs.group_name).toBeNull();
      const k = `${cs.class_id}|${cs.choice_group}`;
      byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
    }
    for (const n of byGroup.values()) expect(n).toBeGreaterThanOrEqual(2);
  });

  it('NCTB: Religion choice at class 5, Agriculture / Home Science at class 7', async () => {
    const t = await newSchool();
    await svc.apply(t, uid, {
      preset_id: 'bd/nctb',
      start_year: 2026,
      stages: ['PRIMARY', 'JUNIOR', 'SECONDARY', 'HIGHER_SECONDARY'],
      versions: ['bangla', 'english'],
    });
    const rows = await csRows(t);
    const at = (grade: number, group: string) =>
      rows.filter((r) => r.class.numeric_grade === grade && r.class.version === 'bangla' && r.choice_group === group);
    expect(at(5, 'Religion')).toHaveLength(4);
    expect(at(7, 'Agriculture / Home Science').map((r) => r.subject.code).sort()).toEqual(
      expect.arrayContaining(['P-10', 'P-11']),
    );
  });

  it('NCTB PRIMARY + bangla only: 5 classes, none above 5', async () => {
    const t = await newSchool();
    await svc.apply(t, uid, {
      preset_id: 'bd/nctb',
      start_year: 2026,
      stages: ['PRIMARY'],
      versions: ['bangla'],
    });
    const classes = await ds.getRepository(Class).find({ where: { tenant_id: t } });
    expect(classes).toHaveLength(5);
    expect(Math.max(...classes.map((c) => c.numeric_grade ?? 0))).toBeLessThanOrEqual(5);
  });
});
