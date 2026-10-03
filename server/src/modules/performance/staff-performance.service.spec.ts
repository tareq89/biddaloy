import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { StaffPerformanceService } from './staff-performance.service';

const T = 'tenant-1';
const CALLER = 'admin-1';
const SUBJECT = 'teacher-user-1';
const Q = { academicYearId: 'y1' } as any;
const RANGE = { academicYearId: 'y1', termId: null, from: '2026-01-01', to: '2026-12-31' };

describe('StaffPerformanceService', () => {
  let memberships: any, teacherRepo: any, tcsRepo: any, sectionRepo: any;
  let acr: any, surveys: any, incidents: any, performance: any;
  let service: StaffPerformanceService;

  beforeEach(() => {
    memberships = { findOne: vi.fn(async () => ({ user_id: SUBJECT })) };
    teacherRepo = { find: vi.fn(async () => [{ id: 't1' }]) };
    tcsRepo = {
      find: vi.fn(async () => [{ section_id: 's1' }, { section_id: 's1' }, { section_id: 's2' }]),
    };
    sectionRepo = {
      find: vi.fn(async () => [
        { id: 's1', class_id: 'c1' },
        { id: 's2', class_id: 'c2' },
      ]),
    };
    acr = {
      history: vi.fn(async () => [
        { academic_year_id: 'y1', status: 'COMPLETED', total: 88, step1_data: { secret: 1 } },
      ]),
    };
    surveys = { teacherAverage: vi.fn(async () => ({ averageStars: null, surveyCount: 0 })) };
    incidents = { list: vi.fn(async () => [{ id: 'i1' }, { id: 'i2' }]) };
    performance = {
      resolveRange: vi.fn(async () => RANGE),
      computeClassOutcomes: vi.fn(async (_t: string, classId: string) => ({ classId })),
    };
    service = new StaffPerformanceService(
      memberships,
      teacherRepo,
      tcsRepo,
      sectionRepo,
      acr,
      surveys,
      incidents,
      performance,
    );
  });

  it('subject gets 404 on own record before anything else is called', async () => {
    await expect(service.get(CALLER, Q, T, CALLER)).rejects.toThrow(NotFoundException);
    expect(memberships.findOne).not.toHaveBeenCalled();
    expect(acr.history).not.toHaveBeenCalled();
    expect(incidents.list).not.toHaveBeenCalled();
    expect(surveys.teacherAverage).not.toHaveBeenCalled();
  });

  it('unknown / cross-tenant user is 404, membership looked up by tenant', async () => {
    memberships.findOne.mockResolvedValue(null);
    await expect(service.get(SUBJECT, Q, T, CALLER)).rejects.toThrow(NotFoundException);
    expect(memberships.findOne.mock.calls[0][0].where.tenant_id).toBe(T);
    expect(acr.history).not.toHaveBeenCalled();
  });

  it('survey average is passed through from the sealed service: null below min-N', async () => {
    const res = await service.get(SUBJECT, Q, T, CALLER);
    expect(surveys.teacherAverage).toHaveBeenCalledWith(SUBJECT, T);
    expect(res.survey).toEqual({ averageStars: null, surveyCount: 0 });
  });

  it('survey average shown when the sealed service returns one', async () => {
    surveys.teacherAverage.mockResolvedValue({ averageStars: 4.2, surveyCount: 1 });
    expect((await service.get(SUBJECT, Q, T, CALLER)).survey.averageStars).toBe(4.2);
  });

  it('maps ACR to year/status/total only and counts incidents', async () => {
    const res = await service.get(SUBJECT, Q, T, CALLER);
    expect(res.acr).toEqual([{ academicYearId: 'y1', status: 'COMPLETED', total: 88 }]);
    expect(res.incidentCount).toBe(2);
    expect(incidents.list).toHaveBeenCalledWith({ staffUserId: SUBJECT }, T, CALLER);
  });

  it('one class outcome per distinct section', async () => {
    const res = await service.get(SUBJECT, Q, T, CALLER);
    expect(res.classes).toHaveLength(2);
    expect(performance.computeClassOutcomes).toHaveBeenCalledWith(T, 'c1', 's1', RANGE);
    expect(sectionRepo.find.mock.calls[0][0].where.tenant_id).toBe(T);
  });

  it('class outcomes are filtered to classes of the requested academic year', async () => {
    await service.get(SUBJECT, Q, T, CALLER);
    // Without this, a section from another year would appear as a stale entry.
    expect(sectionRepo.find.mock.calls[0][0].where.class).toEqual({
      tenant_id: T,
      academic_year_id: 'y1',
    });
  });

  it('non-teacher staff gets classes: []', async () => {
    teacherRepo.find.mockResolvedValue([]);
    const res = await service.get(SUBJECT, Q, T, CALLER);
    expect(res.classes).toEqual([]);
    expect(performance.computeClassOutcomes).not.toHaveBeenCalled();
  });

  it('teacher lookup includes soft-deleted teachers (former staff keep historical classes)', async () => {
    await service.get(SUBJECT, Q, T, CALLER);
    expect(teacherRepo.find.mock.calls[0][0]).toMatchObject({
      where: { user_id: SUBJECT, tenant_id: T },
      withDeleted: true,
    });
  });

  it('bounds class-outcome concurrency and keeps section order', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    sectionRepo.find.mockResolvedValue(ids.map((id, i) => ({ id, class_id: `c${i}` })));
    let inFlight = 0;
    let max = 0;
    performance.computeClassOutcomes.mockImplementation(async (_t: string, classId: string) => {
      max = Math.max(max, ++inFlight);
      // Reverse-staggered delays: later sections finish first, so order must come from index.
      await new Promise((r) => setTimeout(r, 20 - Number(classId.slice(1)) * 2));
      inFlight--;
      return { classId };
    });
    const res = await service.get(SUBJECT, Q, T, CALLER);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
    expect(res.classes.map((c) => c.classId)).toEqual(ids.map((_, i) => `c${i}`));
  });
});
