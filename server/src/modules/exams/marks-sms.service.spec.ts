import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { MarkStatus, MarkGridState } from '@biddaloy/shared';
import { MarksSmsService, buildMarksBody } from './marks-sms.service';
import { Exam } from './entities/exam.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Student } from '../students/entities/student.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';

const T = 'tenant-1';
const GRID = 'grid-1';

describe('buildMarksBody', () => {
  const base = { name: 'Rafi', exam: 'Term 1', subject: 'Math' };
  const ok = { obtained: 18, full_marks: 25, is_absent: false, component_failed: false };

  it('en: marks only', () => {
    expect(buildMarksBody({ ...base, locale: 'en', total: ok })).toBe('Rafi — Term 1, Math: 18/25');
  });
  it('bn: absent in words', () => {
    expect(buildMarksBody({ ...base, locale: 'bn', total: { ...ok, is_absent: true } })).toBe(
      'Rafi — Term 1, Math: অনুপস্থিত',
    );
  });
  it('failed component says fail; grade only when given', () => {
    expect(
      buildMarksBody({ ...base, locale: 'en', total: { ...ok, component_failed: true } }),
    ).toBe('Rafi — Term 1, Math: 18/25 (fail)');
    expect(buildMarksBody({ ...base, locale: 'bn', total: ok, grade: 'A' })).toBe(
      'Rafi — Term 1, Math: 18/25, গ্রেড A',
    );
  });
});

function build(
  opts: {
    state?: string;
    guardians?: any[];
    marks?: any[];
    existing?: Array<{ reference_key: string; created_at: Date }>;
    locale?: string;
    resultSubjects?: any[];
  } = {},
) {
  const {
    state = MarkGridState.SUBMITTED,
    guardians = [{ id: 'g1', phone: '017', full_name: 'P', notifications_enabled: true }],
    marks = [{ student_id: 's1', component_id: 'c1', value: '18', status: MarkStatus.PRESENT }],
    existing = [],
    locale = 'en-BD',
    resultSubjects = [],
  } = opts;
  const gridRepo: any = {
    findOne: vi.fn(async () => ({
      id: GRID,
      tenant_id: T,
      exam_id: 'e1',
      section_id: 'sec',
      subject_id: 'sub',
      state,
    })),
    manager: {
      findOne: vi.fn(async (e: any) => {
        if (e === Exam) return { name: 'Term 1' };
        if (e === Subject) return { name_en: 'Math', name_bn: 'গণিত' };
        if (e === School) return { settings: { region: { locale } } };
      }),
      find: vi.fn(async (e: any) => {
        if (e === ExamComponent) return [{ id: 'c1', full_marks: '25', pass_marks: null }];
        if (e === Student)
          return [{ id: 's1', full_name: 'Rafi', full_name_bn: 'রাফি', guardians }];
        if (e === Mark) return marks;
        if (e === Result) return [{ id: 'r1', student_id: 's1' }];
        if (e === ResultSubject) return resultSubjects;
        return [];
      }),
    },
  };
  const logRepo: any = {
    find: vi.fn(async () => existing),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'log-1', ...v })),
  };
  const batchRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'b1', ...v })),
    delete: vi.fn(),
  };
  const queue: any = { add: vi.fn() };
  const credit: any = {
    isMetered: vi.fn(async () => false),
    reserve: vi.fn(async () => ({ ok: true })),
  };
  const service = new MarksSmsService(gridRepo, logRepo, batchRepo, queue, credit, {
    record: vi.fn(),
  } as any);
  return { service, queue, credit, batchRepo, logRepo };
}

describe('MarksSmsService', () => {
  it('refuses a grid that is not SUBMITTED with a fixed sentence', async () => {
    const { service } = build({ state: MarkGridState.DRAFT });
    await expect(service.preview(GRID, T)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.send(GRID, T, 'u')).rejects.toThrow(/not submitted/);
  });

  it('preview and send agree; body is en with no grade when no result_subjects row', async () => {
    const { service, queue, logRepo } = build();
    const p = await service.preview(GRID, T);
    expect(p).toMatchObject({ count: 1, segments: 1, skipped: [], already_sent_at: null });
    const o = await service.send(GRID, T, 'u');
    expect(o.queued).toBe(p.count);
    expect(o.segments).toBe(p.segments);
    expect(logRepo.save.mock.calls[0][0].message_body).toBe('Rafi — Term 1, Math: 18/25');
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' }); // unmetered: no segments
  });

  it('adds the grade when a result_subjects row exists', async () => {
    const { service, logRepo } = build({ resultSubjects: [{ result_id: 'r1', grade: 'A' }] });
    await service.send(GRID, T, 'u');
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('grade A');
  });

  it('bn school uses Bangla name and absent word', async () => {
    const { service, logRepo } = build({
      locale: 'bn-BD',
      marks: [{ student_id: 's1', component_id: 'c1', value: null, status: MarkStatus.ABSENT }],
    });
    await service.send(GRID, T, 'u');
    expect(logRepo.save.mock.calls[0][0].message_body).toBe('রাফি — Term 1, গণিত: অনুপস্থিত');
  });

  it('skips: notifications off, no reachable guardian, no marks', async () => {
    const off = build({
      guardians: [{ id: 'g1', phone: '017', full_name: 'P', notifications_enabled: false }],
    });
    expect((await off.service.preview(GRID, T)).skipped).toEqual([
      { student_id: 's1', reason: 'notifications_off' },
    ]);
    const none = build({ guardians: [] });
    expect((await none.service.preview(GRID, T)).skipped[0].reason).toBe('no_reachable_guardian');
    const nm = build({ marks: [] });
    expect((await nm.service.preview(GRID, T)).skipped[0].reason).toBe('no_marks');
  });

  it('second call drops sent pairs and reports already_sent_at; reserves nothing', async () => {
    const at = new Date('2026-11-01T00:00:00Z');
    const { service, credit, batchRepo } = build({
      existing: [{ reference_key: `marks-sms:${GRID}:s1:g1`, created_at: at }],
    });
    const o = await service.send(GRID, T, 'u');
    expect(o).toMatchObject({ queued: 0, already_sent_at: at });
    expect(credit.reserve).not.toHaveBeenCalled();
    expect(batchRepo.save).not.toHaveBeenCalled();
  });
});
