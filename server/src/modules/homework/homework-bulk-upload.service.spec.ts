import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HomeworkBulkUploadService } from './homework-bulk-upload.service';
import { REQUIRED_HEADERS, BulkUploadHeader } from './homework-bulk-upload.parser';
import { HomeworkGradingMode, HomeworkAssignmentStatus, UserRole } from '@biddaloy/shared';

/**
 * Unit tests for HomeworkBulkUploadService, with every repository and
 * collaborator mocked (no DB) — mirrors the mocking style used for other
 * pure-logic services in this module. Focuses on the validate()/commit()
 * split: row-level errors from validate(), row creation from commit().
 */

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const CLASS_ID = '00000000-0000-4000-8000-000000000010';
const SECTION_ID = '00000000-0000-4000-8000-000000000011';
const SUBJECT_ID = '00000000-0000-4000-8000-000000000012';
const ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000013';

const DEFAULTS: Record<BulkUploadHeader, string> = {
  class: 'Class One',
  section: 'Section A',
  subject: 'Mathematics',
  assigned_date: '2026-01-01',
  due_date: '2026-01-08',
  description: 'Chapter 1 exercises',
};

function rowValues(
  headers: readonly string[],
  overrides: Partial<Record<BulkUploadHeader, string>> = {},
): string[] {
  const merged = { ...DEFAULTS, ...overrides };
  return headers.map((h) => merged[h as BulkUploadHeader] ?? '');
}

async function buildXlsxFile(
  headers: string[],
  rows: string[][],
  filename = 'homework.xlsx',
): Promise<Express.Multer.File> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Homework');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname: filename } as Express.Multer.File;
}

describe('HomeworkBulkUploadService', () => {
  let service: HomeworkBulkUploadService;
  let staging: { stage: ReturnType<typeof vi.fn>; consume: ReturnType<typeof vi.fn> };
  let access: {
    isTenantWide: ReturnType<typeof vi.fn>;
    assertCanManageSection: ReturnType<typeof vi.fn>;
  };
  let savedHomework: unknown[];
  let savedAssignments: unknown[];

  function fakeTransactionManager() {
    savedHomework = [];
    savedAssignments = [];
    return {
      getRepository: (entity: { name: string }) => {
        if (entity.name === 'Homework') {
          return {
            create: (data: unknown) => data,
            save: async (data: Record<string, unknown>) => {
              const row = { ...data, id: `homework-${savedHomework.length + 1}` };
              savedHomework.push(row);
              return row;
            },
          };
        }
        return {
          create: (data: unknown) => data,
          save: async (data: unknown) => {
            savedAssignments.push(data);
            return data;
          },
        };
      },
    };
  }

  beforeEach(() => {
    staging = { stage: vi.fn(), consume: vi.fn() };

    const classRepo = {
      find: vi.fn().mockResolvedValue([
        { id: CLASS_ID, name: 'Class One', tenant_id: TENANT_ID, academic_year_id: ACADEMIC_YEAR_ID },
      ]),
    };
    const sectionRepo = {
      find: vi
        .fn()
        .mockResolvedValue([{ id: SECTION_ID, class_id: CLASS_ID, section_name: 'Section A' }]),
    };
    const academicYearRepo = {
      findOne: vi.fn().mockResolvedValue({ id: ACADEMIC_YEAR_ID, is_current: true }),
    };
    const subjectRepo = {
      find: vi.fn().mockResolvedValue([{ id: SUBJECT_ID, name_en: 'Mathematics' }]),
    };
    const homeworkRepo = {
      manager: { transaction: (fn: (manager: unknown) => unknown) => fn(fakeTransactionManager()) },
    };
    const assignmentRepo = {};
    access = {
      isTenantWide: vi.fn((role: string) => role === UserRole.ADMIN),
      assertCanManageSection: vi.fn(async () => undefined),
    };

    service = new HomeworkBulkUploadService(
      classRepo as never,
      sectionRepo as never,
      academicYearRepo as never,
      subjectRepo as never,
      homeworkRepo as never,
      assignmentRepo as never,
      staging as never,
      access as never,
    );
  });

  describe('validate', () => {
    it('stages a valid row and reports no errors', async () => {
      staging.stage.mockResolvedValue({ stagingId: 'stage-1', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile([...REQUIRED_HEADERS], [rowValues(REQUIRED_HEADERS)]);

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(0);
      expect(result.rows_to_create).toBe(1);
      expect(result.preview).toEqual([
        {
          row: 2,
          class: 'Class One',
          section: 'Section A',
          subject: 'Mathematics',
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        },
      ]);
      expect(staging.stage).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        expect.objectContaining({ hardErrorCount: 0 }),
      );
    });

    it('reports an unknown class name with row+column context', async () => {
      staging.stage.mockResolvedValue({ stagingId: 'stage-2', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile(
        [...REQUIRED_HEADERS],
        [rowValues(REQUIRED_HEADERS, { class: 'No Such Class' })],
      );

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({ row: 2, column: 'class', value: 'No Such Class' });
    });

    it('reports an unknown section name with row+column context', async () => {
      staging.stage.mockResolvedValue({ stagingId: 'stage-3', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile(
        [...REQUIRED_HEADERS],
        [rowValues(REQUIRED_HEADERS, { section: 'No Such Section' })],
      );

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({
        row: 2,
        column: 'section',
        value: 'No Such Section',
      });
    });

    it('reports an unknown subject name with row+column context', async () => {
      staging.stage.mockResolvedValue({ stagingId: 'stage-4', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile(
        [...REQUIRED_HEADERS],
        [rowValues(REQUIRED_HEADERS, { subject: 'No Such Subject' })],
      );

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({
        row: 2,
        column: 'subject',
        value: 'No Such Subject',
      });
    });

    it('throws a parse error when a required column is missing', async () => {
      const headersMissingSubject = REQUIRED_HEADERS.filter((h) => h !== 'subject');
      const file = await buildXlsxFile(
        [...headersMissingSubject],
        [rowValues(headersMissingSubject as unknown as readonly BulkUploadHeader[])],
      );

      await expect(service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN)).rejects.toThrow(
        'Missing required columns: subject',
      );
    });

    it('reports a malformed date as a row-level error', async () => {
      staging.stage.mockResolvedValue({ stagingId: 'stage-5', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile(
        [...REQUIRED_HEADERS],
        [rowValues(REQUIRED_HEADERS, { assigned_date: 'not-a-date' })],
      );

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({ row: 2, column: 'assigned_date' });
    });

    it('throws when no file is uploaded', async () => {
      await expect(service.validate(undefined, TENANT_ID, USER_ID, UserRole.ADMIN)).rejects.toThrow(
        'No file uploaded',
      );
    });

    it('rejects a class/section name that matches more than one section', async () => {
      const AMBIGUOUS_CLASS_ID = '00000000-0000-4000-8000-000000000099';
      const AMBIGUOUS_SECTION_ID = '00000000-0000-4000-8000-00000000009a';
      service = new HomeworkBulkUploadService(
        {
          find: vi.fn().mockResolvedValue([
            { id: CLASS_ID, name: 'Class One', tenant_id: TENANT_ID, academic_year_id: ACADEMIC_YEAR_ID },
            {
              id: AMBIGUOUS_CLASS_ID,
              name: 'Class One',
              tenant_id: TENANT_ID,
              academic_year_id: ACADEMIC_YEAR_ID,
            },
          ]),
        } as never,
        {
          find: vi.fn().mockResolvedValue([
            { id: SECTION_ID, class_id: CLASS_ID, section_name: 'Section A' },
            { id: AMBIGUOUS_SECTION_ID, class_id: AMBIGUOUS_CLASS_ID, section_name: 'Section A' },
          ]),
        } as never,
        {
          findOne: vi.fn().mockResolvedValue({ id: ACADEMIC_YEAR_ID, is_current: true }),
        } as never,
        {
          find: vi.fn().mockResolvedValue([{ id: SUBJECT_ID, name_en: 'Mathematics' }]),
        } as never,
        { manager: { transaction: (fn: (manager: unknown) => unknown) => fn(fakeTransactionManager()) } } as never,
        {} as never,
        staging as never,
        access as never,
      );
      staging.stage.mockResolvedValue({ stagingId: 'stage-7', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile([...REQUIRED_HEADERS], [rowValues(REQUIRED_HEADERS)]);

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.ADMIN);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({ column: 'class' });
    });

    it('reports a row-level access error for a teacher not mapped to the section', async () => {
      access.isTenantWide.mockReturnValue(false);
      access.assertCanManageSection.mockRejectedValue(new ForbiddenException('not linked'));
      staging.stage.mockResolvedValue({ stagingId: 'stage-6', expiresAt: '2026-01-01T00:00:00Z' });
      const file = await buildXlsxFile([...REQUIRED_HEADERS], [rowValues(REQUIRED_HEADERS)]);

      const result = await service.validate(file, TENANT_ID, USER_ID, UserRole.TEACHER);

      expect(result.hard_error_count).toBe(1);
      expect(result.errors[0]).toMatchObject({ row: 2, column: 'section' });
    });
  });

  describe('commit', () => {
    it('creates one Homework and one HomeworkAssignment per staged row', async () => {
      staging.consume.mockResolvedValue({
        filename: 'homework.xlsx',
        hardErrorCount: 0,
        rows: [
          {
            rowNumber: 2,
            class: 'Class One',
            section: 'Section A',
            subject: 'Mathematics',
            assigned_date: '2026-01-01',
            due_date: '2026-01-08',
            description: 'Chapter 1',
            classId: CLASS_ID,
            sectionId: SECTION_ID,
            subjectId: SUBJECT_ID,
          },
        ],
      });

      const result = await service.commit('stage-1', TENANT_ID, USER_ID);

      expect(result).toMatchObject({ total_rows: 1, success_count: 1, error_count: 0 });
      expect(savedHomework).toHaveLength(1);
      expect(savedHomework[0]).toMatchObject({
        subject_id: SUBJECT_ID,
        class_id: CLASS_ID,
        grading_mode: HomeworkGradingMode.TICK,
        tenant_id: TENANT_ID,
      });
      expect(savedAssignments).toHaveLength(1);
      expect(savedAssignments[0]).toMatchObject({
        section_id: SECTION_ID,
        student_id: null,
        status: HomeworkAssignmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      });
    });

    it('404s when the staging id is unknown or already committed', async () => {
      staging.consume.mockResolvedValue(null);

      await expect(service.commit('missing', TENANT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409s when the staged upload had validation errors', async () => {
      staging.consume.mockResolvedValue({ filename: 'x.xlsx', hardErrorCount: 1, rows: [] });

      await expect(service.commit('stage-err', TENANT_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
