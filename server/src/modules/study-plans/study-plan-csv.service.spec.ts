import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, type StudyPlanLesson } from '@biddaloy/shared';
import { StudyPlanCsvService } from './study-plan-csv.service';
import { parseLessonSheet, StudyPlanParseError } from './study-plan-csv.parser';
import type { StudyPlanCaller } from './study-plans.service';

const TENANT = '00000000-0000-4000-8000-000000000001';
const CLASS_ID = '00000000-0000-4000-8000-0000000000c1';
const SUBJECT_ID = '00000000-0000-4000-8000-0000000000a1';
const TOPIC_ID = '00000000-0000-4000-8000-0000000000b1';
const BOM = '﻿';

const caller: StudyPlanCaller = { userId: 'user-1', tenantId: TENANT, role: UserRole.ADMIN };

/** A .csv upload as multer would hand it over. */
const file = (text: string, name = 'lessons.csv') =>
  ({ buffer: Buffer.from(text, 'utf-8'), originalname: name }) as Express.Multer.File;

describe('StudyPlanCsvService', () => {
  const staging = { stage: vi.fn(), peek: vi.fn(), consume: vi.fn() };
  const topicRepo = { find: vi.fn() };
  const classRepo = { findOne: vi.fn() };
  const subjectRepo = { findOne: vi.fn() };
  let service: StudyPlanCsvService;

  beforeEach(() => {
    vi.resetAllMocks();
    staging.stage.mockResolvedValue({ stagingId: 'stage-1', expiresAt: '2030-01-01T00:00:00Z' });
    classRepo.findOne.mockResolvedValue({ id: CLASS_ID });
    subjectRepo.findOne.mockResolvedValue({ id: SUBJECT_ID });
    topicRepo.find.mockResolvedValue([{ id: TOPIC_ID, name: 'ভগ্নাংশ' }]);
    service = new StudyPlanCsvService(
      topicRepo as never,
      {} as never,
      classRepo as never,
      subjectRepo as never,
      {} as never,
      staging as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  const planPair = { class_id: CLASS_ID, subject_id: SUBJECT_ID };
  /** The lessons `validate` staged. */
  const staged = () => staging.stage.mock.calls[0][2] as { lessons: StudyPlanLesson[] };

  describe('export', () => {
    const lessons: StudyPlanLesson[] = [
      { id: 'l1', title: 'ভগ্নাংশের ধারণা', periods: 2, topic_id: TOPIC_ID },
      { id: 'l2', title: 'দশমিকের গুণ', periods: 1, notes: 'পৃষ্ঠা ৪৫' },
      { id: 'l3', title: '=SUM(A1)', periods: 3 },
    ];
    const names = new Map([[TOPIC_ID, 'ভগ্নাংশ']]);

    it('writes BOM, CRLF, a header row and quoted cells', () => {
      const csv = service.buildLessonsCsv(lessons.slice(0, 2), names);
      expect(csv).toBe(
        `${BOM}"title","periods","topic","notes"\r\n` +
          `"ভগ্নাংশের ধারণা","2","ভগ্নাংশ",""\r\n` +
          `"দশমিকের গুণ","1","","পৃষ্ঠা ৪৫"`,
      );
    });

    it('prefixes a title that starts with = so Excel treats it as text', () => {
      const csv = service.buildLessonsCsv(lessons, names);
      expect(csv).toContain(`"'=SUM(A1)"`);
    });

    it('round-trips: parsing the export gives the same lessons (topics by name)', async () => {
      const csv = service.buildLessonsCsv(lessons, names);
      const rows = await parseLessonSheet(Buffer.from(csv, 'utf-8'), 'x.csv');
      expect(rows.map((r) => r.values)).toEqual([
        { title: 'ভগ্নাংশের ধারণা', periods: '2', topic: 'ভগ্নাংশ', notes: '' },
        { title: 'দশমিকের গুণ', periods: '1', topic: '', notes: 'পৃষ্ঠা ৪৫' },
        // The formula guard is undone on the way back in.
        { title: '=SUM(A1)', periods: '3', topic: '', notes: '' },
      ]);
    });
  });

  describe('validate', () => {
    it('rejects a file without the periods column', async () => {
      await expect(service.validate(file('title\r\nA'), planPair, TENANT, caller)).rejects.toThrow(
        'Missing required columns: periods',
      );
      await expect(parseLessonSheet(Buffer.from('title\r\nA'), 'x.csv')).rejects.toBeInstanceOf(
        StudyPlanParseError,
      );
    });

    it('turns periods = 0 and periods = 21 into row errors and blocks the commit', async () => {
      const res = await service.validate(
        file('title,periods\r\nA,0\r\nB,21\r\nC,2'),
        planPair,
        TENANT,
        caller,
      );
      expect(res.errors.map((e) => [e.row, e.column])).toEqual([
        [2, 'periods'],
        [3, 'periods'],
      ]);
      expect(res.rows_to_create).toBe(1);
      // The staged payload remembers the errors so commit refuses it.
      expect((staging.stage.mock.calls[0][2] as { hardErrorCount: number }).hardErrorCount).toBe(2);
    });

    it('rejects a file of 401 lessons', async () => {
      const text =
        'title,periods\r\n' + Array.from({ length: 401 }, (_, i) => `L${i},1`).join('\r\n');
      await expect(service.validate(file(text), planPair, TENANT, caller)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('links a known topic by name and warns (not errors) on an unknown one', async () => {
      const res = await service.validate(
        file('title,periods,topic\r\nA,1, ভগ্নাংশ \r\nB,1,Nope'),
        planPair,
        TENANT,
        caller,
      );
      expect(res.errors).toEqual([]);
      expect(res.warnings.map((w) => [w.row, w.column, w.severity])).toEqual([
        [3, 'topic', 'warning'],
      ]);
      expect(staged().lessons[0].topic_id).toBe(TOPIC_ID);
      expect(staged().lessons[1].topic_id).toBeUndefined();
    });

    it('keeps Bangla titles and notes intact', async () => {
      await service.validate(
        file(`${BOM}title,periods,notes\r\nদশমিকের গুণ,2,পৃষ্ঠা ৪৫`),
        planPair,
        TENANT,
        caller,
      );
      expect(staged().lessons[0]).toMatchObject({ title: 'দশমিকের গুণ', notes: 'পৃষ্ঠা ৪৫' });
    });

    it('needs exactly one pair: neither or both is a 400', async () => {
      const csv = file('title,periods\r\nA,1');
      await expect(service.validate(csv, {}, TENANT, caller)).rejects.toThrow(BadRequestException);
      await expect(
        service.validate(
          csv,
          { ...planPair, class_grade: 7, subject_code: 'MATH' },
          TENANT,
          caller,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('template pair: topic cells become warnings and no topics are looked up', async () => {
      const res = await service.validate(
        file('title,periods,topic\r\nA,1,ভগ্নাংশ'),
        { class_grade: 7, subject_code: 'MATH' },
        TENANT,
        caller,
      );
      expect(res.warnings[0].message).toBe('topics are not kept in templates');
      expect(topicRepo.find).not.toHaveBeenCalled();
      expect(staged().lessons[0].topic_id).toBeUndefined();
    });
  });

  describe('commit', () => {
    it('404s when the staging id was already consumed or never existed', async () => {
      staging.peek.mockResolvedValue(null);
      await expect(
        service.commit({ staging_id: 'gone', plan_id: 'p1' }, TENANT, caller),
      ).rejects.toThrow(NotFoundException);
    });

    it('needs exactly one target', async () => {
      await expect(service.commit({ staging_id: 's' }, TENANT, caller)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
