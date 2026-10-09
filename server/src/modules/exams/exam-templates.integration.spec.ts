import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExamComponentKind, ExamKind } from '@biddaloy/shared';
import { ExamTemplatesService } from './exam-templates.service';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplateComponent } from './entities/exam-template-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

const comp = (name: string, full: number, pass: number) => ({
  name,
  kind: ExamComponentKind.WRITTEN,
  full,
  pass,
});

describe('ExamTemplatesService (integration)', () => {
  let service: ExamTemplatesService;
  let ds: DataSource;
  let subjects: Repository<Subject>;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ExamTemplatesService,
        { provide: AuditService, useValue: { record: async () => undefined } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(ExamTemplatesService);
    ds = module.get(DataSource);
    const schools = module.get(getRepositoryToken(School));
    await schools.save(
      schools.create({ id: SEED_TENANT_ID, name: 'S', slug: 's', tenant_id: SEED_TENANT_ID }),
    );
    subjects = module.get(getRepositoryToken(Subject));
  }, 120_000);

  // test/setup.ts truncates `subjects` before every test, so seed it here.
  beforeEach(async () => {
    await subjects.save(
      subjects.create({ tenant_id: SEED_TENANT_ID, code: 'BAN', name_en: 'Bangla' } as any),
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('replace-rows is atomic: a failing insert leaves the old rows intact', async () => {
    const t = await service.create({ name: 'Atomic', kind: ExamKind.TERM }, SEED_TENANT_ID);
    await service.update(
      t.id,
      { rows: [{ classGrade: 6, subjectCode: 'BAN', components: [comp('Written', 100, 33)] }] },
      SEED_TENANT_ID,
    );
    // varchar(20) overflow passes DTO-less validation but fails in the DB insert.
    await expect(
      service.update(
        t.id,
        {
          rows: [
            { classGrade: 7, subjectCode: 'X'.repeat(30), components: [comp('Written', 50, 10)] },
          ],
        },
        SEED_TENANT_ID,
      ),
    ).rejects.toBeDefined();
    const after = await service.get(t.id, SEED_TENANT_ID);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({
      classGrade: 6,
      subjectCode: 'BAN',
      subjectName: 'Bangla',
    });
  });

  it('delete hides the template from list and removes its component rows', async () => {
    const t = await service.create({ name: 'Gone', kind: ExamKind.MODEL }, SEED_TENANT_ID);
    await service.update(
      t.id,
      { rows: [{ classGrade: 6, subjectCode: 'BAN', components: [comp('Written', 100, 33)] }] },
      SEED_TENANT_ID,
    );
    await service.remove(t.id, SEED_TENANT_ID);
    expect((await service.list(SEED_TENANT_ID)).map((x) => x.name)).not.toContain('Gone');
    const left = await ds
      .getRepository(ExamTemplateComponent)
      .count({ where: { template_id: t.id } });
    expect(left).toBe(0);
    const row = await ds
      .getRepository(ExamTemplate)
      .findOne({ where: { id: t.id }, withDeleted: true });
    expect(row?.deleted_at).not.toBeNull();
  });

  it('duplicate live name is 409; name is reusable after delete', async () => {
    const a = await service.create({ name: 'Dup', kind: ExamKind.TERM }, SEED_TENANT_ID);
    await expect(
      service.create({ name: 'Dup', kind: ExamKind.TERM }, SEED_TENANT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.remove(a.id, SEED_TENANT_ID);
    await expect(
      service.create({ name: 'Dup', kind: ExamKind.TERM }, SEED_TENANT_ID),
    ).resolves.toBeDefined();
  });

  it('list reports rowCount and classGrades', async () => {
    const t = await service.create({ name: 'Listed', kind: ExamKind.TERM }, SEED_TENANT_ID);
    await service.update(
      t.id,
      {
        rows: [
          { classGrade: 9, subjectCode: 'BAN', components: [comp('W', 100, 33)] },
          {
            classGrade: 6,
            subjectCode: 'BAN',
            components: [comp('W', 100, 33), comp('M', 50, 10)],
          },
        ],
      },
      SEED_TENANT_ID,
    );
    const item = (await service.list(SEED_TENANT_ID)).find((x) => x.id === t.id);
    expect(item).toMatchObject({ rowCount: 2, classGrades: [6, 9] });
  });
});
