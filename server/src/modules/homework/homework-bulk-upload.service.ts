import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, IsNull, In } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkAccessService } from './homework-access.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { parseSpreadsheet, BulkUploadParseError, ParsedRow } from './homework-bulk-upload.parser';
import {
  HomeworkBulkUploadResultDto,
  HomeworkBulkUploadRowDto,
  HomeworkBulkUploadValidateResultDto,
  HomeworkBulkUploadPreviewRowDto,
} from './dto/homework-bulk-upload.dto';
import { HomeworkGradingMode, HomeworkAssignmentStatus } from '@biddaloy/shared';

/**
 * A row-scoped failure enriched with which spreadsheet column the problem
 * sits in and the offending cell value — same pattern as
 * students/bulk-upload.service.ts's BulkRowError.
 */
class BulkRowError extends BadRequestException {
  constructor(
    message: string,
    readonly field?: string,
    readonly value?: string,
  ) {
    super(message);
  }
}

/** Current-academic-year class/section/subject names resolved once per upload. */
interface ClassLookup {
  /** `"<class name>::<section name>"` → class-section id. */
  sectionIdByKey: Map<string, string>;
  /** `"<class name>::<section name>"` → class id (needed for `Homework.class_id`). */
  classIdByKey: Map<string, string>;
  /** Every class name of the year, sections or not. */
  classNames: Set<string>;
}

/**
 * A plain, JSON-serialisable row shape — deliberately not a
 * `HomeworkBulkUploadRowDto` instance, since the staged payload round-trips
 * through Redis as JSON.
 */
interface ValidatedBulkUploadRow {
  rowNumber: number;
  class: string;
  section: string;
  subject: string;
  assigned_date: string;
  due_date: string;
  description?: string;
  classId: string;
  sectionId: string;
  subjectId: string;
}

/** What `validate` stages under a `staging_id`, for `commit` to consume exactly once. */
interface StagedBulkUpload {
  filename: string;
  rows: ValidatedBulkUploadRow[];
  hardErrorCount: number;
}

@Injectable()
export class HomeworkBulkUploadService {
  constructor(
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Homework)
    private readonly homeworkRepo: Repository<Homework>,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
    private readonly access: HomeworkAccessService,
  ) {}

  /**
   * Parses and validates the upload — headers, per-row DTO shape,
   * class/section/subject existence — without writing anything. Accepted
   * rows are staged under a `staging_id` for a later `commit`; rejected
   * rows are reported as errors and never staged.
   */
  async validate(
    file: Express.Multer.File | undefined,
    tenantId: string,
    userId: string | undefined,
    role: string,
  ): Promise<HomeworkBulkUploadValidateResultDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    let rows: ParsedRow[];
    try {
      rows = await parseSpreadsheet(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof BulkUploadParseError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const classLookup = await this.buildClassLookup(tenantId);
    const subjectIdByName = await this.buildSubjectLookup(tenantId);
    // Access is checked here, in validate — never in commit — because the
    // staged payload can only ever be consumed by the same (tenant, user,
    // staging_id) that created it (ImportStagingService's key shape), so a
    // staged row can't be tampered with between the two calls. Checking
    // here also surfaces access failures as a per-row validation error in
    // the preview, rather than a generic commit failure. Memoized per
    // (section, subject) pair since a large upload can repeat the same
    // section/subject across many rows.
    const accessCache = new Map<string, boolean>();

    const errors: BulkImportErrorDto[] = [];
    const staged: ValidatedBulkUploadRow[] = [];
    const preview: HomeworkBulkUploadPreviewRowDto[] = [];

    for (const parsed of rows) {
      try {
        const row = await this.validateRow(parsed, classLookup, subjectIdByName);
        await this.assertRowAccess(row, role, userId, tenantId, accessCache);
        staged.push(row);
        preview.push({
          row: row.rowNumber,
          class: row.class,
          section: row.section,
          subject: row.subject,
          assigned_date: row.assigned_date,
          due_date: row.due_date,
        });
      } catch (err) {
        if (err instanceof BadRequestException) {
          errors.push({
            row: parsed.rowNumber,
            tab: undefined,
            column: err instanceof BulkRowError ? (err.field ?? null) : null,
            value: err instanceof BulkRowError ? err.value : undefined,
            severity: 'error',
            message: this.describeError(err),
          });
        } else {
          throw err;
        }
      }
    }

    const stagedPayload: StagedBulkUpload = {
      filename: file.originalname,
      rows: staged,
      hardErrorCount: errors.length,
    };
    const { stagingId, expiresAt } = await this.staging.stage(
      tenantId,
      userId ?? '',
      stagedPayload,
    );

    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      rows_to_create: staged.length,
      preview: preview.slice(0, 20),
      errors,
      hard_error_count: errors.length,
    };
  }

  /**
   * Consumes the staged payload (single use — a second `commit` call 404s)
   * and creates one `Homework` + one section-scoped `HomeworkAssignment`
   * (default TICK grading mode, per D21) for each staged row.
   */
  async commit(
    stagingId: string,
    tenantId: string,
    userId: string | undefined,
  ): Promise<HomeworkBulkUploadResultDto> {
    const staged = await this.staging.consume<StagedBulkUpload>(tenantId, userId ?? '', stagingId);
    if (!staged) {
      throw new NotFoundException(
        'No staged upload found for this id. It may have expired or already been committed.',
      );
    }
    if (staged.hardErrorCount > 0) {
      throw new ConflictException(
        'This staged upload had validation errors and cannot be committed. Re-validate the file first.',
      );
    }

    // All-or-nothing: `createRow` never throws `BadRequestException` (every
    // row was already validated in `validate`), so one transaction for the
    // whole batch is safe — a mid-batch DB failure rolls back every row
    // instead of leaving a partial commit that a retry could duplicate
    // (the staged payload is consumed via GETDEL before the first write,
    // so there's no going back to a clean "nothing written yet" state
    // otherwise).
    const createdHomeworkIds = await this.homeworkRepo.manager.transaction(async (manager) => {
      const ids: string[] = [];
      for (const row of staged.rows) {
        ids.push(await this.createRow(manager, row, tenantId));
      }
      return ids;
    });

    return {
      total_rows: staged.rows.length,
      success_count: createdHomeworkIds.length,
      error_count: 0,
      created_homework_ids: createdHomeworkIds,
      errors: [],
    };
  }

  /** Tenant-wide roles skip the check entirely (isTenantWide); a TEACHER
   * must have a `teacher_class_sections` row for the row's (section,
   * subject) — same gate `HomeworkService.assign` uses for a single
   * assignment, applied per row here. */
  private async assertRowAccess(
    row: ValidatedBulkUploadRow,
    role: string,
    userId: string | undefined,
    tenantId: string,
    cache: Map<string, boolean>,
  ): Promise<void> {
    if (this.access.isTenantWide(role)) return;
    const cacheKey = `${row.sectionId}:${row.subjectId}`;
    if (cache.get(cacheKey)) return;
    try {
      await this.access.assertCanManageSection(
        role,
        userId ?? '',
        row.sectionId,
        row.subjectId,
        tenantId,
      );
      cache.set(cacheKey, true);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new BulkRowError(
          `You do not have access to Class '${row.class}' / Section '${row.section}' for subject '${row.subject}'`,
          'section',
          row.section,
        );
      }
      throw err;
    }
  }

  /**
   * Everything checkable without touching the database beyond read-only
   * lookups: DTO shape, class/section/subject existence. Throws
   * `BulkRowError` — never writes.
   */
  private async validateRow(
    parsed: ParsedRow,
    classLookup: ClassLookup,
    subjectIdByName: Map<string, string>,
  ): Promise<ValidatedBulkUploadRow> {
    const dto = plainToInstance(HomeworkBulkUploadRowDto, this.toDtoInput(parsed.values));
    const validationErrors = await validate(dto);
    if (validationErrors.length > 0) {
      const messages = validationErrors.flatMap((e) => Object.values(e.constraints ?? {}));
      if (validationErrors.length === 1) {
        const failed = validationErrors[0];
        const rawValue = (parsed.values as Record<string, string | undefined>)[failed.property];
        throw new BulkRowError(
          messages.join('; '),
          failed.property,
          rawValue === '' ? undefined : rawValue,
        );
      }
      throw new BadRequestException(messages.join('; '));
    }

    const sectionKey = `${dto.class}::${dto.section}`;
    const sectionId = classLookup.sectionIdByKey.get(sectionKey);
    if (!sectionId) {
      const classExists = classLookup.classNames.has(dto.class);
      throw new BulkRowError(
        `Class '${dto.class}' / Section '${dto.section}' not found for the current academic year`,
        classExists ? 'section' : 'class',
        classExists ? dto.section : dto.class,
      );
    }
    const classId = classLookup.classIdByKey.get(sectionKey) as string;

    const subjectId = subjectIdByName.get(dto.subject);
    if (!subjectId) {
      throw new BulkRowError(`Subject '${dto.subject}' not found`, 'subject', dto.subject);
    }

    if (new Date(dto.due_date) < new Date(dto.assigned_date)) {
      throw new BulkRowError(
        `due_date (${dto.due_date}) cannot be before assigned_date (${dto.assigned_date})`,
        'due_date',
        dto.due_date,
      );
    }

    return {
      rowNumber: parsed.rowNumber,
      class: dto.class,
      section: dto.section,
      subject: dto.subject,
      assigned_date: dto.assigned_date,
      due_date: dto.due_date,
      description: dto.description,
      classId,
      sectionId,
      subjectId,
    };
  }

  private async createRow(
    manager: EntityManager,
    row: ValidatedBulkUploadRow,
    tenantId: string,
  ): Promise<string> {
    const homework = await manager.getRepository(Homework).save(
      manager.getRepository(Homework).create({
        title: `${row.subject} — ${row.assigned_date}`,
        description: row.description ?? null,
        subject_id: row.subjectId,
        class_id: row.classId,
        grading_mode: HomeworkGradingMode.TICK,
        tenant_id: tenantId,
      }),
    );

    await manager.getRepository(HomeworkAssignment).save(
      manager.getRepository(HomeworkAssignment).create({
        homework_id: homework.id,
        section_id: row.sectionId,
        student_id: null,
        assigned_date: row.assigned_date,
        due_date: row.due_date,
        status: HomeworkAssignmentStatus.ACTIVE,
        tenant_id: tenantId,
      }),
    );

    return homework.id;
  }

  private toDtoInput(raw: Record<string, string>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = value === '' ? undefined : value;
    }
    return out;
  }

  private async buildClassLookup(tenantId: string): Promise<ClassLookup> {
    const currentYear = await this.academicYearRepo.findOne({
      where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
    });
    if (!currentYear) {
      throw new BadRequestException('No current academic year configured for this tenant');
    }

    const classes = await this.classRepo.find({
      where: { tenant_id: tenantId, academic_year_id: currentYear.id, deleted_at: IsNull() },
    });
    const classIds = classes.map((c) => c.id);
    const sections = classIds.length
      ? await this.sectionRepo.find({
          where: { tenant_id: tenantId, class_id: In(classIds), deleted_at: IsNull() },
        })
      : [];

    const classById = new Map(classes.map((c) => [c.id, c]));
    const sectionIdByKey = new Map<string, string>();
    const classIdByKey = new Map<string, string>();
    for (const section of sections) {
      const cls = classById.get(section.class_id);
      if (!cls) continue;
      const key = `${cls.name}::${section.section_name}`;
      sectionIdByKey.set(key, section.id);
      classIdByKey.set(key, cls.id);
    }
    return { sectionIdByKey, classIdByKey, classNames: new Set(classes.map((c) => c.name)) };
  }

  private async buildSubjectLookup(tenantId: string): Promise<Map<string, string>> {
    const subjects = await this.subjectRepo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const map = new Map<string, string>();
    for (const s of subjects) {
      map.set(s.name_en, s.id);
      if (s.name_bn) map.set(s.name_bn, s.id);
    }
    return map;
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
