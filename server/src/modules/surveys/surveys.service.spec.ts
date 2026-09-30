import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SurveysService } from './surveys.service';

describe('SurveysService', () => {
  const TENANT = 'tenant-1';
  let survey: Record<string, unknown> | null;
  let surveyRepo: Record<string, ReturnType<typeof vi.fn>>;
  let questionRepo: Record<string, ReturnType<typeof vi.fn>>;
  let targetRepo: Record<string, ReturnType<typeof vi.fn>>;
  let tcsRepo: { findOne: ReturnType<typeof vi.fn> };
  let service: SurveysService;

  const base = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    tenant_id: TENANT,
    status: 'DRAFT',
    opens_at: null,
    closes_at: null,
    ...over,
  });

  beforeEach(() => {
    survey = base();
    surveyRepo = {
      findOne: vi.fn(async () => survey),
      save: vi.fn(async (v) => v),
      update: vi.fn(),
      find: vi.fn(),
    };
    questionRepo = { find: vi.fn(async () => []), count: vi.fn(async () => 1) };
    targetRepo = { find: vi.fn(async () => []), count: vi.fn(async () => 1) };
    tcsRepo = { findOne: vi.fn(async () => ({ id: 'tcs-1' })) };
    service = new SurveysService(
      surveyRepo as never,
      questionRepo as never,
      targetRepo as never,
      tcsRepo as never,
    );
  });

  it('cannot edit an OPEN survey', async () => {
    survey = base({ status: 'OPEN' });
    await expect(service.update('s1', { title: 'x' }, TENANT)).rejects.toThrow(BadRequestException);
  });

  it('rejects a target that is not a real teacher+subject assignment', async () => {
    tcsRepo.findOne.mockResolvedValue(null);
    await expect(
      service.create(
        {
          title: 't',
          anonymous: true,
          respondent: 'BOTH',
          questions: [{ text: 'q', starsEnabled: true }],
          targets: [{ teacherId: 'a', subjectId: 'b' }],
        },
        TENANT,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tcsRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: TENANT, teacher_id: 'a', subject_id: 'b' },
      }),
    );
  });

  it('auto-closes an OPEN survey past closes_at on read', async () => {
    survey = base({ status: 'OPEN', closes_at: new Date(Date.now() - 1000) });
    const res = await service.findOne('s1', TENANT);
    expect(res.status).toBe('CLOSED');
    expect(surveyRepo.save).toHaveBeenCalled();
  });

  it('404s a survey outside the tenant (query is tenant-scoped)', async () => {
    survey = null;
    await expect(service.findOne('s1', TENANT)).rejects.toThrow(NotFoundException);
    expect(surveyRepo.findOne).toHaveBeenCalledWith({ where: { id: 's1', tenant_id: TENANT } });
  });

  it('enforces DRAFT->OPEN->CLOSED', async () => {
    await service.publish('s1', TENANT);
    expect(survey?.status).toBe('OPEN');
    await expect(service.publish('s1', TENANT)).rejects.toThrow(BadRequestException);
    await service.close('s1', TENANT);
    expect(survey?.status).toBe('CLOSED');
    await expect(service.close('s1', TENANT)).rejects.toThrow(BadRequestException);
  });

  it('refuses to publish a survey with no questions', async () => {
    questionRepo.count.mockResolvedValue(0);
    await expect(service.publish('s1', TENANT)).rejects.toThrow(BadRequestException);
  });
});
