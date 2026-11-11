import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PromotionRunStatus, UserRole } from '@biddaloy/shared';
import {
  PromotionGroupsService,
  pickResult,
  matchesFilters,
  type GroupResult,
} from './promotion-groups.service';
import { ListPromotionGroupsQueryDto } from './dto/promotions.dto';

const row = (gpa: string) => ({
  student_id: 's1',
  gpa,
  subjects: [{ subject_code: 'MATH', marks: 80, grade: 'A+' }],
});

describe('pickResult (D16)', () => {
  it('prefers the final result over the exam', () => {
    const result = pickResult(row('4.50'), row('3.00'));
    expect(result.source).toBe('FINAL_RESULT');
    expect(result.gpa).toBe(4.5);
  });

  it('falls back to the exam, then to an empty result', () => {
    expect(pickResult(undefined, row('3.00')).source).toBe('EXAM');
    expect(pickResult(undefined, undefined)).toEqual({ gpa: null, subjects: [], source: null });
  });
});

describe('matchesFilters', () => {
  const result: GroupResult = {
    gpa: 4,
    subjects: [{ subject_code: 'MATH', marks: 70, grade: 'A' }],
    source: 'EXAM',
  };

  it('no filter matches everyone, even a student with no result', () => {
    expect(matchesFilters({ gpa: null, subjects: [], source: null }, {})).toBe(true);
  });

  it('applies gpa bounds and the per-subject minimum', () => {
    expect(matchesFilters(result, { gpa_min: 4 })).toBe(true);
    expect(matchesFilters(result, { gpa_min: 4.5 })).toBe(false);
    expect(matchesFilters(result, { gpa_max: 3.5 })).toBe(false);
    expect(matchesFilters(result, { subject_code: 'MATH', marks_min: 70 })).toBe(true);
    expect(matchesFilters(result, { subject_code: 'MATH', marks_min: 71 })).toBe(false);
    expect(matchesFilters(result, { subject_code: 'BANGLA' })).toBe(false);
  });

  it('a student with no result never matches an active filter', () => {
    expect(matchesFilters({ gpa: null, subjects: [], source: null }, { gpa_min: 1 })).toBe(false);
  });
});

describe('ListPromotionGroupsQueryDto', () => {
  const errorsFor = (plain: object) =>
    validate(plainToInstance(ListPromotionGroupsQueryDto, plain)).then((e) =>
      e.map((x) => x.property),
    );

  it('caps limit at 100', async () => {
    expect(await errorsFor({ limit: '100' })).toEqual([]);
    expect(await errorsFor({ limit: '101' })).toContain('limit');
  });

  it('needs a subject_code with marks_min', async () => {
    expect(await errorsFor({ marks_min: '60' })).toContain('subject_code');
    expect(await errorsFor({ marks_min: '60', subject_code: 'MATH' })).toEqual([]);
  });
});

describe('PromotionGroupsService', () => {
  const actor = { tenantId: 't1', role: UserRole.TEACHER, userId: 'u1' };

  function build(opts: { homeroom?: string[]; groups?: string[]; status?: string } = {}) {
    const runRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'r1',
        status: opts.status ?? PromotionRunStatus.DRAFT,
      }),
    };
    const entryRepo = { find: vi.fn().mockResolvedValue([]) };
    const promotions = { patchEntries: vi.fn() };
    const teacherScope = {
      homeroomSections: vi
        .fn()
        .mockResolvedValue((opts.homeroom ?? []).map((s) => ({ section_id: s }))),
    };
    const settings = {
      organisationVocabulary: vi.fn().mockResolvedValue({ groups: opts.groups ?? ['Science'] }),
    };
    const service = new PromotionGroupsService(
      runRepo as any,
      entryRepo as any,
      promotions as any,
      teacherScope as any,
      settings as any,
    );
    return { service, entryRepo, promotions };
  }

  it('list: a teacher with no homeroom gets an empty page and no entry is read', async () => {
    const { service, entryRepo } = build({ homeroom: [] });
    const page = await service.list('r1', {}, actor);
    expect(page).toEqual({ data: [], total: 0, page: 1, limit: 50 });
    expect(entryRepo.find).not.toHaveBeenCalled();
  });

  it('list: a teacher whose homeroom has no entry in the run gets 404', async () => {
    const { service } = build({ homeroom: ['sec-1'] });
    await expect(service.list('r1', {}, actor)).rejects.toThrow('Promotion run not found');
  });

  it('set: no groups vocabulary is 422 GROUPS_NOT_CONFIGURED', async () => {
    const { service, promotions } = build({ groups: [] });
    await expect(service.set('r1', ['e1'], 'Science', actor)).rejects.toMatchObject({
      response: { details: { code: 'GROUPS_NOT_CONFIGURED' } },
    });
    expect(promotions.patchEntries).not.toHaveBeenCalled();
  });

  it('set: a non-DRAFT run is 409', async () => {
    const { service } = build({ status: PromotionRunStatus.COMMITTED });
    await expect(service.set('r1', ['e1'], 'Science', actor)).rejects.toThrow(
      'Only DRAFT runs can be edited',
    );
  });

  it('set: an unknown entry id is 404 and nothing is written', async () => {
    const { service, promotions } = build();
    await expect(service.set('r1', ['e1'], 'Science', actor)).rejects.toThrow(
      'Promotion entries not found',
    );
    expect(promotions.patchEntries).not.toHaveBeenCalled();
  });
});
