import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchoolsService } from '../schools/schools.service';
import { addDays, localToday } from '../attendance/attendance-policy.util';
import { IntakeService } from './intake.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionDocumentType, AdmissionTemplateKey, ADMISSION_TEMPLATES } from '@biddaloy/shared';
import { AdmissionStage } from './entities/admission-stage.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makeIntake(overrides: Partial<AdmissionIntake> = {}): AdmissionIntake {
  return {
    id: 'intake-1',
    tenant_id: TENANT_A,
    class_section_id: 'section-1',
    title: 'Class 1 intake 2026',
    seat_count: 40,
    open_date: '2020-01-01',
    close_date: '2099-01-01',
    required_document_types: [AdmissionDocumentType.PHOTO],
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  } as AdmissionIntake;
}

describe('IntakeService', () => {
  let service: IntakeService;
  let repo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    manager: { query: ReturnType<typeof vi.fn> };
  };
  let stageRepo: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let txQuery: ReturnType<typeof vi.fn>;
  let yearClosed: boolean;

  beforeEach(async () => {
    yearClosed = false;
    stageRepo = { create: vi.fn((x) => x), save: vi.fn(async (x) => x) };
    txQuery = vi.fn(async () => [{ closed_at: yearClosed ? new Date() : null }]);
    repo = {
      manager: { query: vi.fn(async () => []) },
      create: vi.fn((dto) => dto),
      save: vi.fn(async (entity) => ({ ...makeIntake(), ...entity })),
      find: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
    };

    const repos = new Map<unknown, unknown>([
      [AdmissionIntake, repo],
      [AdmissionStage, stageRepo],
      [Class, { findOne: vi.fn(async () => ({ id: 'class-1', academic_year_id: 'year-1' })) }],
      [ClassSection, { findOne: vi.fn(async () => ({ id: 'section-1', class_id: 'class-1' })) }],
    ]);
    const txManager = { query: txQuery, getRepository: (e: unknown) => repos.get(e) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: getRepositoryToken(AdmissionIntake), useValue: repo },
        {
          provide: DataSource,
          useValue: { transaction: async (cb: (m: unknown) => unknown) => cb(txManager) },
        },
        // real clock + Dhaka (the default region), so a fake Date drives it
        { provide: SchoolsService, useValue: { todayFor: async () => localToday('Asia/Dhaka') } },
      ],
    }).compile();

    service = moduleRef.get(IntakeService);
  });

  afterEach(() => vi.useRealTimers());

  it('02:00 Dhaka on the 16th: an intake closing the 15th is CLOSED, and close() writes the school-local yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T20:00:00Z'));
    repo.findOne.mockResolvedValue(
      makeIntake({ open_date: '2026-03-01', close_date: '2026-03-15' }),
    );
    expect((await service.findOne('intake-1', TENANT_A)).status).toBe('CLOSED');
    await service.close('intake-1', TENANT_A);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'intake-1', tenant_id: TENANT_A },
      { open_date: '2026-03-01', close_date: '2026-03-15' },
    );
  });

  it('creates an intake scoped to the caller tenant', async () => {
    const result = await service.create(
      {
        title: 'Class 1 intake 2026',
        class_section_id: 'section-1',
        seat_count: 40,
        open_date: '2020-01-01',
        close_date: '2099-01-01',
        required_document_types: [AdmissionDocumentType.PHOTO],
      },
      TENANT_A,
    );

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A }));
    expect(result.tenant_id).toBe(TENANT_A);
  });

  it('lists only intakes for the caller tenant, with class and section names', async () => {
    repo.find.mockResolvedValue([
      makeIntake({
        class_section: { section_name: 'A', class: { name: 'Class 6' } },
      } as Partial<AdmissionIntake>),
    ]);
    const rows = await service.findAll(TENANT_A);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.every((w: { tenant_id: string }) => w.tenant_id === TENANT_A)).toBe(true);
    expect(arg.where[1].class_section.tenant_id).toBe(TENANT_A);
    expect(arg.where[1].class_section.class.tenant_id).toBe(TENANT_A);
    expect(arg.relations.class_section.class).toBe(true);
    expect(rows[0]).toMatchObject({ class_name: 'Class 6', section_name: 'A' });
    expect(rows[0]).not.toHaveProperty('class_section');
    expect(rows[0]).toMatchObject({ stage_count: 0, status_counts: {} });
  });

  it('adds stage count and applicant counts per status to each list row', async () => {
    repo.find.mockResolvedValue([makeIntake()]);
    repo.manager.query
      .mockResolvedValueOnce([{ intake_id: 'intake-1', n: '2' }])
      .mockResolvedValueOnce([
        { intake_id: 'intake-1', status: 'PENDING', n: '3' },
        { intake_id: 'intake-1', status: 'ADMITTED', n: '1' },
      ]);
    const [row] = await service.findAll(TENANT_A);
    expect(row.stage_count).toBe(2);
    expect(row.status_counts).toEqual({ PENDING: 3, ADMITTED: 1 });
  });

  describe.each(Object.values(AdmissionTemplateKey))('create with template %s', (key) => {
    it('inserts the stages of the template, in order, for this tenant', async () => {
      await service.create(
        {
          title: 'T',
          class_id: 'class-1',
          template_key: key,
          seat_count: 40,
          open_date: '2020-01-01',
          close_date: '2099-01-01',
          required_document_types: [],
        },
        TENANT_A,
      );
      const stages = stageRepo.save.mock.calls[0][0] as Array<{
        kind: string;
        position: number;
        tenant_id: string;
      }>;
      expect(stages.map((s) => s.kind)).toEqual(ADMISSION_TEMPLATES[key].stages.map((s) => s.kind));
      expect(stages.map((s) => s.position)).toEqual(stages.map((_, i) => i + 1));
      expect(stages.every((s) => s.tenant_id === TENANT_A)).toBe(true);
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        template_key: key,
        form_fields: ADMISSION_TEMPLATES[key].fields,
        class_id: 'class-1',
        academic_year_id: 'year-1',
        class_section_id: null,
      });
    });
  });

  it('create in a closed year is a 409 and writes nothing', async () => {
    yearClosed = true;
    await expect(
      service.create(
        {
          title: 'T',
          class_id: 'class-1',
          seat_count: 1,
          open_date: '2020-01-01',
          close_date: '2099-01-01',
          required_document_types: [],
        },
        TENANT_A,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(stageRepo.save).not.toHaveBeenCalled();
  });

  it('create with neither class_id nor class_section_id is a 400', async () => {
    await expect(
      service.create(
        {
          title: 'T',
          seat_count: 1,
          open_date: '2020-01-01',
          close_date: '2099-01-01',
          required_document_types: [],
        },
        TENANT_A,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('legacy class_section_id derives the class and keeps the section', async () => {
    await service.create(
      {
        title: 'T',
        class_section_id: 'section-1',
        seat_count: 1,
        open_date: '2020-01-01',
        close_date: '2099-01-01',
        required_document_types: [],
      },
      TENANT_A,
    );
    expect(repo.save.mock.calls[0][0]).toMatchObject({
      class_id: 'class-1',
      class_section_id: 'section-1',
    });
  });

  it('update on a round of a closed year is a 409', async () => {
    repo.findOne.mockResolvedValue(makeIntake({ academic_year_id: 'year-1' }));
    yearClosed = true;
    await expect(service.update('intake-1', { seat_count: 5 }, TENANT_A)).rejects.toThrow(
      ConflictException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects findOne for an intake belonging to a different tenant', async () => {
    // Tenant-scoped repo query returns nothing for a cross-tenant lookup.
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('intake-1', TENANT_B)).rejects.toThrow(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_B }) }),
    );
  });

  it('updates an intake, scoping both the ownership check and the write to the tenant', async () => {
    repo.findOne.mockResolvedValue(makeIntake({ seat_count: 40 }));
    await service.update('intake-1', { seat_count: 50 }, TENANT_A);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'intake-1', tenant_id: TENANT_A },
      { seat_count: 50 },
    );
  });

  it('closes an intake by pulling close_date back to yesterday, so it reads CLOSED the same day', async () => {
    repo.findOne.mockResolvedValue(makeIntake());
    await service.close('intake-1', TENANT_A);
    const yesterday = addDays(localToday('Asia/Dhaka'), -1);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'intake-1', tenant_id: TENANT_A },
      { open_date: '2020-01-01', close_date: yesterday },
    );
  });

  it('also pulls open_date back when it would otherwise invert the range', async () => {
    const today = localToday('Asia/Dhaka');
    repo.findOne.mockResolvedValue(makeIntake({ open_date: today }));
    await service.close('intake-1', TENANT_A);
    const yesterday = addDays(localToday('Asia/Dhaka'), -1);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'intake-1', tenant_id: TENANT_A },
      { open_date: yesterday, close_date: yesterday },
    );
  });

  it('derives status OPEN when today falls within open_date..close_date', async () => {
    repo.findOne.mockResolvedValue(
      makeIntake({ open_date: '2020-01-01', close_date: '2099-01-01' }),
    );
    const result = await service.findOne('intake-1', TENANT_A);
    expect(result.status).toBe('OPEN');
  });

  it('derives status CLOSED when today is past close_date', async () => {
    repo.findOne.mockResolvedValue(
      makeIntake({ open_date: '2020-01-01', close_date: '2020-01-02' }),
    );
    const result = await service.findOne('intake-1', TENANT_A);
    expect(result.status).toBe('CLOSED');
  });

  it('rejects create when open_date is after close_date', async () => {
    await expect(
      service.create(
        {
          title: 'Bad range',
          class_section_id: 'section-1',
          seat_count: 40,
          open_date: '2099-01-01',
          close_date: '2020-01-01',
          required_document_types: [AdmissionDocumentType.PHOTO],
        },
        TENANT_A,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects update when the patched date range is inverted', async () => {
    repo.findOne.mockResolvedValue(
      makeIntake({ open_date: '2020-01-01', close_date: '2099-01-01' }),
    );
    await expect(
      service.update('intake-1', { close_date: '2019-01-01' }, TENANT_A),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
