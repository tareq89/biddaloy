import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { NCTB_PACK } from '../../packs/bd/nctb';
import type { PresetPack } from '@biddaloy/shared';
import { makeTestPack } from '../../__fixtures__/test-pack';
import type { ApplyContext } from '../apply-context';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { ClassSubject } from '../../../academics/entities/class-subject.entity';
import { writeYear } from './year.writer';
import { writeClasses } from './classes.writer';
import { writeSubjects } from './subjects.writer';
import { writeClassSubjects } from './class-subjects.writer';
import { writeSettings } from './settings.writer';

describe('academic preset writers (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  /** Fresh tenant + all five writers in order, in one transaction. */
  async function run(opts: {
    startMonth?: number;
    stages: string[];
    versions?: string[];
    pack?: PresetPack;
  }): Promise<{ tenantId: string; counts: Record<string, number> }> {
    const pack = opts.pack ?? makeTestPack();
    if (!opts.pack) pack.yearShape.startMonth = opts.startMonth ?? 1;
    if (opts.versions && !opts.pack)
      pack.versions = [
        { key: 'BN', name: { en: 'Bangla', bn: 'বাংলা' } },
        { key: 'EN', name: { en: 'English', bn: 'ইংরেজি' } },
      ];
    const tenantId = randomUUID();
    await ds.getRepository(School).save({
      id: tenantId,
      name: 'Writers School',
      slug: `writers-${tenantId}`,
      settings: { version: 1, fees: { keep: true } } as any,
    });
    const counts: Record<string, number> = {};
    await ds.transaction(async (manager) => {
      const ctx: ApplyContext = {
        manager,
        tenantId,
        userId: randomUUID(),
        pack,
        options: {
          presetId: pack.id,
          startYear: 2026,
          stages: opts.stages,
          versions: opts.versions ?? [],
        },
        ids: {
          classIdByKey: new Map(),
          subjectIdByCode: new Map(),
          classSubjectIdByKey: new Map(),
        },
      };
      for (const w of [writeSettings, writeYear, writeClasses, writeSubjects, writeClassSubjects])
        Object.assign(counts, await w(ctx));
    });
    return { tenantId, counts };
  }

  it('startMonth 1 -> calendar-year name, Jan 1 to Dec 31, current', async () => {
    const { tenantId } = await run({ stages: ['PRIMARY'] });
    const y = await ds.getRepository(AcademicYear).findOneByOrFail({ tenant_id: tenantId });
    expect(y.name).toBe('2026');
    expect(String(y.start_date)).toBe('2026-01-01');
    expect(String(y.end_date)).toBe('2026-12-31');
    expect(y.is_current).toBe(true);
  });

  it('startMonth 7 -> 2026-2027, Jul 1 to Jun 30', async () => {
    const { tenantId } = await run({ startMonth: 7, stages: ['PRIMARY'] });
    const y = await ds.getRepository(AcademicYear).findOneByOrFail({ tenant_id: tenantId });
    expect(y.name).toBe('2026-2027');
    expect(String(y.start_date)).toBe('2026-07-01');
    expect(String(y.end_date)).toBe('2027-06-30');
  });

  it('unselected stage creates no class and no subject used only by it', async () => {
    const { tenantId, counts } = await run({ stages: ['PRIMARY'] });
    expect(counts).toMatchObject({ classes: 2, subjects: 2, classSubjects: 2 });
    const codes = (await ds.getRepository(Subject).findBy({ tenant_id: tenantId })).map(
      (s) => s.code,
    );
    expect(codes.sort()).toEqual(['BAN', 'ENG']);
  });

  it('two selected versions double classes and class-subjects, subjects stay single', async () => {
    const { tenantId, counts } = await run({ stages: ['PRIMARY'], versions: ['BN', 'EN'] });
    expect(counts).toMatchObject({ classes: 4, subjects: 2, classSubjects: 4 });
    const versions = (await ds.getRepository(Class).findBy({ tenant_id: tenantId })).map(
      (c) => c.version,
    );
    expect(versions.sort()).toEqual(['BN', 'BN', 'EN', 'EN']);
  });

  it('copies group_name / is_optional, defaults the rest', async () => {
    const { tenantId } = await run({ stages: ['SECONDARY'] });
    const rows = await ds.getRepository(ClassSubject).find({
      where: { tenant_id: tenantId },
      relations: { subject: true },
    });
    const phy = rows.find((r) => r.subject.code === 'PHY')!;
    const mat = rows.find((r) => r.subject.code === 'MAT')!;
    expect(phy.group_name).toBe('SCIENCE');
    expect(mat.group_name).toBeNull();
    expect(mat.is_optional).toBe(false);
    expect(mat.is_graded_only).toBe(false);
  });

  it('writes choice_group from the pack row', async () => {
    const pack = makeTestPack();
    pack.classSubjects = [
      { classGrade: 1, subjectCode: 'BAN', choiceGroup: 'L2' },
      { classGrade: 1, subjectCode: 'ENG', choiceGroup: 'L2' },
    ];
    pack.examTemplates = [];
    const { tenantId } = await run({ stages: ['PRIMARY'], pack });
    const rows = await ds.getRepository(ClassSubject).findBy({ tenant_id: tenantId });
    expect(rows.map((r) => r.choice_group)).toEqual(['L2', 'L2']);
  });

  it('applying NCTB: class 5 has 4 Religion rows, class 7 has the Agri/Home group', async () => {
    const { tenantId } = await run({
      stages: ['PRIMARY', 'JUNIOR'],
      versions: NCTB_PACK.versions?.length ? [NCTB_PACK.versions[0].key] : [],
      pack: NCTB_PACK,
    });
    const rows = await ds.getRepository(ClassSubject).find({
      where: { tenant_id: tenantId },
      relations: { class: true },
    });
    const of = (grade: number, g: string) =>
      rows.filter((r) => r.class.numeric_grade === grade && r.choice_group === g);
    expect(of(5, 'Religion')).toHaveLength(4);
    expect(of(5, 'Agriculture / Home Science')).toHaveLength(0);
    expect(of(7, 'Agriculture / Home Science')).toHaveLength(2);
  });

  it('settings writer sets vocabulary, region and preset block, keeps other blocks', async () => {
    const { tenantId, counts } = await run({ stages: ['PRIMARY'], versions: ['BN'] });
    expect(counts.settings).toBe(1);
    const s = (await ds.getRepository(School).findOneByOrFail({ id: tenantId })).settings!;
    expect(s.organisation).toEqual({ shifts: [], versions: ['BN'], groups: ['SCIENCE'] });
    expect(s.region.locale).toBeDefined();
    expect(s.preset).toMatchObject({ id: 'test/pack', version: '1.0' });
    expect(s.fees).toEqual({ keep: true });
  });
});
