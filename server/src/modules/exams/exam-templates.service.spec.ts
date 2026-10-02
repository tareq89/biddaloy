import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExamComponentKind, ExamKind } from '@biddaloy/shared';
import { ExamTemplatesService } from './exam-templates.service';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplateComponent } from './entities/exam-template-component.entity';

const TENANT = 'tenant-1';
const TPL = 't-1';

const comp = (o: Partial<ExamTemplateComponent>): ExamTemplateComponent =>
  ({
    template_id: TPL,
    class_grade: 6,
    subject_code: 'BAN',
    sequence: 0,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    full_marks: '70.00',
    pass_marks: '23.00',
    ...o,
  }) as ExamTemplateComponent;

function build(
  opts: { template?: Partial<ExamTemplate> | null; comps?: ExamTemplateComponent[] } = {},
) {
  const tplRepo: any = {
    findOne: vi.fn(async () =>
      opts.template === null
        ? null
        : { id: TPL, tenant_id: TENANT, name: 'Term', kind: ExamKind.TERM, ...opts.template },
    ),
    find: vi.fn(async () => []),
    save: vi.fn(async (v: any) => ({ id: TPL, ...v })),
    update: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
  };
  const compRepo: any = {
    find: vi.fn(async () => opts.comps ?? []),
    delete: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
  };
  const subjectRepo: any = { find: vi.fn(async () => [{ code: 'BAN', name_en: 'Bangla' }]) };
  const manager: any = {
    getRepository: (e: unknown) => (e === ExamTemplate ? tplRepo : compRepo),
    transaction: undefined,
  };
  tplRepo.manager = { ...manager, transaction: vi.fn(async (cb: any) => cb(manager)) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ExamTemplatesService(tplRepo, compRepo, subjectRepo, audit as any);
  return { service, tplRepo, compRepo, audit, manager };
}

const row = (o: any = {}) => ({
  classGrade: 6,
  subjectCode: 'BAN',
  components: [{ name: 'Written', kind: ExamComponentKind.WRITTEN, full: 70, pass: 23 }],
  ...o,
});

describe('ExamTemplatesService', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build({ comps: [comp({})] });
  });

  it('creates an empty template with audit', async () => {
    const res = await t.service.create({ name: 'Term', kind: ExamKind.TERM }, TENANT, 'u1');
    expect(t.tplRepo.save).toHaveBeenCalledWith({
      tenant_id: TENANT,
      name: 'Term',
      kind: ExamKind.TERM,
    });
    expect(t.audit.record).toHaveBeenCalledOnce();
    expect(res.id).toBe(TPL);
  });

  it('renames without touching components', async () => {
    await t.service.update(TPL, { name: 'Final' }, TENANT);
    expect(t.tplRepo.update).toHaveBeenCalledWith(
      { id: TPL, tenant_id: TENANT },
      { name: 'Final' },
    );
    expect(t.compRepo.delete).not.toHaveBeenCalled();
  });

  it('replaces rows via tenant-scoped delete + insert, sequence = array order', async () => {
    await t.service.update(
      TPL,
      {
        rows: [
          row({
            components: [
              { name: 'MCQ', kind: ExamComponentKind.MCQ, full: 35, pass: 12 },
              { name: 'Written', kind: ExamComponentKind.WRITTEN, full: 35, pass: 12 },
            ],
          }),
        ],
      },
      TENANT,
    );
    expect(t.compRepo.delete).toHaveBeenCalledWith({ tenant_id: TENANT, template_id: TPL });
    const lines = t.compRepo.insert.mock.calls[0][0];
    expect(lines.map((l: any) => [l.name, l.sequence, l.full_marks])).toEqual([
      ['MCQ', 0, '35'],
      ['Written', 1, '35'],
    ]);
  });

  it('rejects pass > full with 400 before writing', async () => {
    const bad = row({ components: [{ name: 'W', kind: 'WRITTEN', full: 10, pass: 11 }] });
    await expect(t.service.update(TPL, { rows: [bad] }, TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.compRepo.delete).not.toHaveBeenCalled();
  });

  it('allows one ATTENDANCE component per row, rejects two with 400', async () => {
    const att = (name: string) => ({ name, kind: ExamComponentKind.ATTENDANCE, full: 5, pass: 0 });
    await t.service.update(TPL, { rows: [row({ components: [att('A')] })] }, TENANT);
    const two = row({ components: [att('A'), att('B')] });
    await expect(t.service.update(TPL, { rows: [two] }, TENANT)).rejects.toThrow(
      /At most one ATTENDANCE/,
    );
  });

  it('rejects full <= 0, duplicate component names and duplicate rows', async () => {
    const zero = row({ components: [{ name: 'W', kind: 'WRITTEN', full: 0, pass: 0 }] });
    const dupName = row({
      components: [
        { name: 'W', kind: 'WRITTEN', full: 10, pass: 3 },
        { name: 'W', kind: 'MCQ', full: 10, pass: 3 },
      ],
    });
    for (const rows of [[zero], [dupName], [row(), row()]]) {
      await expect(t.service.update(TPL, { rows }, TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('maps a 23505 to 409', async () => {
    t.tplRepo.save.mockRejectedValue({ code: '23505' });
    await expect(
      t.service.create({ name: 'Term', kind: ExamKind.TERM }, TENANT),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delete hard-deletes components then soft-deletes the template, tenant-scoped', async () => {
    await t.service.remove(TPL, TENANT, 'u1');
    expect(t.compRepo.delete).toHaveBeenCalledWith({ tenant_id: TENANT, template_id: TPL });
    expect(t.tplRepo.softDelete).toHaveBeenCalledWith({ id: TPL, tenant_id: TENANT });
    expect(t.audit.record).toHaveBeenCalledOnce();
  });

  it('foreign / missing template id is 404 on get, update, remove', async () => {
    const n = build({ template: null });
    await expect(n.service.get(TPL, TENANT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(n.service.update(TPL, { name: 'x' }, TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(n.service.remove(TPL, TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(n.tplRepo.findOne.mock.calls[0][0].where).toMatchObject({ tenant_id: TENANT });
  });

  it('get groups rows and resolves subjectName (null when absent)', async () => {
    const g = build({
      comps: [comp({}), comp({ subject_code: 'XYZ', name: 'Viva', kind: ExamComponentKind.VIVA })],
    });
    const res = await g.service.get(TPL, TENANT);
    expect(res.rows.map((r) => [r.subjectCode, r.subjectName])).toEqual([
      ['BAN', 'Bangla'],
      ['XYZ', null],
    ]);
    expect(res.rows[0].components[0]).toEqual({
      name: 'Written',
      kind: 'WRITTEN',
      full: 70,
      pass: 23,
      sequence: 0,
    });
  });

  it('componentsFor filters by tenant, template, grade and subject codes', async () => {
    await t.service.componentsFor(t.manager, TENANT, TPL, 6, ['BAN', 'ENG']);
    const where = t.compRepo.find.mock.calls.at(-1)[0].where;
    expect(where).toMatchObject({ tenant_id: TENANT, template_id: TPL, class_grade: 6 });
    expect(where.subject_code._value).toEqual(['BAN', 'ENG']);
    expect(await t.service.componentsFor(t.manager, TENANT, TPL, 6, [])).toEqual([]);
  });
});
