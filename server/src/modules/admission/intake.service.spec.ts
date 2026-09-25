import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IntakeService } from './intake.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionDocumentType } from '@biddaloy/shared';

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
  };

  beforeEach(async () => {
    repo = {
      create: vi.fn((dto) => dto),
      save: vi.fn(async (entity) => ({ ...makeIntake(), ...entity })),
      find: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [IntakeService, { provide: getRepositoryToken(AdmissionIntake), useValue: repo }],
    }).compile();

    service = moduleRef.get(IntakeService);
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

  it('lists only intakes for the caller tenant', async () => {
    repo.find.mockResolvedValue([makeIntake()]);
    await service.findAll(TENANT_A);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_A }) }),
    );
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
    expect(repo.update).toHaveBeenCalledWith({ id: 'intake-1', tenant_id: TENANT_A }, { seat_count: 50 });
  });

  it('closes an intake by pulling close_date back to today', async () => {
    repo.findOne.mockResolvedValue(makeIntake());
    await service.close('intake-1', TENANT_A);
    const today = new Date().toISOString().slice(0, 10);
    expect(repo.update).toHaveBeenCalledWith({ id: 'intake-1', tenant_id: TENANT_A }, { close_date: today });
  });

  it('derives status OPEN when today falls within open_date..close_date', async () => {
    repo.findOne.mockResolvedValue(makeIntake({ open_date: '2020-01-01', close_date: '2099-01-01' }));
    const result = await service.findOne('intake-1', TENANT_A);
    expect(result.status).toBe('OPEN');
  });

  it('derives status CLOSED when today is past close_date', async () => {
    repo.findOne.mockResolvedValue(makeIntake({ open_date: '2020-01-01', close_date: '2020-01-02' }));
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
    repo.findOne.mockResolvedValue(makeIntake({ open_date: '2020-01-01', close_date: '2099-01-01' }));
    await expect(service.update('intake-1', { close_date: '2019-01-01' }, TENANT_A)).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
