import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { StudentService, GuardianService } from './students.service';
import { parseSpreadsheet, BulkUploadParseError, ParsedRow } from './bulk-upload.parser';
import {
  BulkUploadErrorDto,
  BulkUploadResultDto,
  BulkUploadRowDto,
  BulkUploadValidateResultDto,
  BulkUploadPreviewRowDto,
} from './dto/students.dto';
import { AuditAction, CommunicationMedium } from '@biddaloy/shared';

/**
 * A row-scoped failure enriched with which spreadsheet column the problem
 * sits in and the offending cell value, when a single culprit exists.
 * Extends BadRequestException so the row-scoped-vs-whole-request catch in
 * `validate`/`commit` keeps working unchanged.
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

/** Current-academic-year class/section names resolved once per upload. */
interface ClassSectionLookup {
  /** `"<class name>::<section name>"` → class-section id. */
  sectionIdByKey: Map<string, string>;
  /** Every class name of the year, sections or not. */
  classNames: Set<string>;
}

interface GuardianInput {
  name: string;
  phone: string;
  email?: string;
}

/**
 * A plain, JSON-serialisable row shape holding everything `createRow` needs
 * — deliberately not a `BulkUploadRowDto` instance, since the staged payload
 * round-trips through Redis as JSON and only plain data survives that.
 */
interface ValidatedBulkUploadRow {
  rowNumber: number;
  student_name: string;
  class: string;
  section: string;
  roll?: string;
  guardian1_name: string;
  guardian1_phone: string;
  guardian1_email?: string;
  guardian2_name?: string;
  guardian2_phone?: string;
  guardian2_email?: string;
  home_address?: string;
  preferred_communication?: string;
  classSectionId: string;
  rollNumber?: number;
}

/** What `validate` stages under a `staging_id`, for `commit` to consume exactly once. */
interface StagedBulkUpload {
  filename: string;
  rows: ValidatedBulkUploadRow[];
  hardErrorCount: number;
}

@Injectable()
export class StudentBulkUploadService {
  constructor(
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    private readonly auditService: AuditService,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
  ) {}

  /**
   * Parses and validates the upload — headers, per-row DTO shape, class/
   * section existence, duplicate roll numbers within the file — without
   * writing anything. Accepted rows are staged under a `staging_id` for a
   * later `commit`; rejected rows are reported as errors and never staged.
   */
  async validate(
    file: Express.Multer.File | undefined,
    tenantId: string,
    userId: string | undefined,
  ): Promise<BulkUploadValidateResultDto> {
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

    const classSections = await this.buildClassSectionMap(tenantId);
    const rollsSeenThisRequest = new Map<string, Set<number>>();

    const errors: BulkImportErrorDto[] = [];
    const staged: ValidatedBulkUploadRow[] = [];
    const preview: BulkUploadPreviewRowDto[] = [];

    for (const parsed of rows) {
      try {
        const row = await this.validateRow(parsed, classSections, rollsSeenThisRequest);
        staged.push(row);
        preview.push({
          row: row.rowNumber,
          student_name: row.student_name,
          class: row.class,
          section: row.section,
          guardian1_phone: row.guardian1_phone,
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
      // Capped so a 2,000-row file doesn't ship every row in the preview
      // payload — the admin is confirming a shape, not proofreading.
      preview: preview.slice(0, 20),
      errors,
      hard_error_count: errors.length,
    };
  }

  /**
   * Consumes the staged payload (single use — a second `commit` call 404s)
   * and actually creates the students and guardians.
   *
   * Refuses (409) when the staged validation had any error, even though the
   * accepted rows themselves are still fine to write: the client is never
   * expected to offer commit in that state, so reaching here with
   * `hardErrorCount > 0` means either a stale UI or a client bypassing its
   * own gate — the server does not silently import a subset in that case.
   */
  async commit(
    stagingId: string,
    tenantId: string,
    userId: string | undefined,
  ): Promise<BulkUploadResultDto> {
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

    const errors: BulkUploadErrorDto[] = [];
    const createdStudentIds: string[] = [];
    const guardianCache = new Map<string, string>();

    for (const row of staged.rows) {
      try {
        const studentId = await this.createRow(row, tenantId, guardianCache, userId);
        createdStudentIds.push(studentId);
      } catch (err) {
        if (err instanceof BadRequestException) {
          errors.push({
            row: row.rowNumber,
            ...(err instanceof BulkRowError && err.field !== undefined ? { field: err.field } : {}),
            ...(err instanceof BulkRowError && err.value !== undefined ? { value: err.value } : {}),
            reason: this.describeError(err),
          });
        } else {
          throw err;
        }
      }
    }

    await this.auditService.record({
      action: AuditAction.BULK_UPLOAD,
      entity_type: 'Student',
      tenant_id: tenantId,
      performed_by_user_id: userId ?? null,
      new_values: {
        filename: staged.filename,
        total_rows: staged.rows.length,
        success_count: createdStudentIds.length,
        error_count: errors.length,
      },
    });

    return {
      total_rows: staged.rows.length,
      success_count: createdStudentIds.length,
      error_count: errors.length,
      created_student_ids: createdStudentIds,
      errors,
    };
  }

  /**
   * Everything checkable without touching the database beyond read-only
   * lookups: DTO shape, class/section existence, and duplicate roll numbers
   * already seen earlier in this same file. Throws `BulkRowError` — never
   * writes. Mutates `rollsSeenThisRequest` on acceptance, same as the old
   * single-pass `processRow` did, so a later row in the same file still
   * sees this one's roll number as taken.
   */
  private async validateRow(
    parsed: ParsedRow,
    classSections: ClassSectionLookup,
    rollsSeenThisRequest: Map<string, Set<number>>,
  ): Promise<ValidatedBulkUploadRow> {
    const dto = plainToInstance(BulkUploadRowDto, this.toDtoInput(parsed.values));
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
    const classSectionId = classSections.sectionIdByKey.get(sectionKey);
    if (!classSectionId) {
      const classExists = classSections.classNames.has(dto.class);
      throw new BulkRowError(
        `Class '${dto.class}' / Section '${dto.section}' not found for the current academic year`,
        classExists ? 'section' : 'class',
        classExists ? dto.section : dto.class,
      );
    }

    let rollNumber: number | undefined;
    if (dto.roll) {
      rollNumber = parseInt(dto.roll, 10);
      const seen = rollsSeenThisRequest.get(classSectionId) ?? new Set<number>();
      if (seen.has(rollNumber)) {
        throw new BulkRowError(
          `Duplicate roll number ${rollNumber} in class '${dto.class}' section '${dto.section}' (already used earlier in this file)`,
          'roll',
          dto.roll,
        );
      }
      seen.add(rollNumber);
      rollsSeenThisRequest.set(classSectionId, seen);
    }

    return {
      rowNumber: parsed.rowNumber,
      student_name: dto.student_name,
      class: dto.class,
      section: dto.section,
      roll: dto.roll,
      guardian1_name: dto.guardian1_name,
      guardian1_phone: dto.guardian1_phone,
      guardian1_email: dto.guardian1_email,
      guardian2_name: dto.guardian2_name,
      guardian2_phone: dto.guardian2_phone,
      guardian2_email: dto.guardian2_email,
      home_address: dto.home_address,
      preferred_communication: dto.preferred_communication,
      classSectionId,
      rollNumber,
    };
  }

  /**
   * The DB-writing half of the old `processRow`: guardian resolution/
   * creation and student creation as one transaction, so a student-create
   * failure rolls back any guardian newly created for this row instead of
   * leaving it orphaned. Runs only from `commit`, over already-validated,
   * staged rows.
   */
  private async createRow(
    row: ValidatedBulkUploadRow,
    tenantId: string,
    guardianCache: Map<string, string>,
    userId: string | undefined,
  ): Promise<string> {
    const guardianResolutions: { phone: string; id: string }[] = [];
    let studentId: string;
    try {
      studentId = await this.classRepo.manager.transaction(async (manager) => {
        const guardianIds: string[] = [];

        const g1Id = await this.resolveGuardian(
          { name: row.guardian1_name, phone: row.guardian1_phone, email: row.guardian1_email },
          tenantId,
          guardianCache,
          manager,
          userId,
        );
        guardianResolutions.push({ phone: row.guardian1_phone, id: g1Id });
        guardianIds.push(g1Id);

        if (row.guardian2_name) {
          const g2Id = await this.resolveGuardian(
            {
              name: row.guardian2_name,
              phone: row.guardian2_phone as string,
              email: row.guardian2_email,
            },
            tenantId,
            guardianCache,
            manager,
            userId,
          );
          guardianResolutions.push({ phone: row.guardian2_phone as string, id: g2Id });
          guardianIds.push(g2Id);
        }

        const student = await this.studentService.create(
          {
            full_name: row.student_name,
            class_section_id: row.classSectionId,
            roll_number: row.rollNumber,
            home_address: row.home_address,
            preferred_communication: row.preferred_communication as CommunicationMedium,
            guardian_ids: guardianIds,
          },
          tenantId,
          manager,
        );
        return student.id;
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        if (row.rollNumber !== undefined && this.violatedColumns(err).includes('roll_number')) {
          throw new BulkRowError(
            `Duplicate roll number ${row.rollNumber} in class '${row.class}' section '${row.section}'`,
            'roll',
            row.roll,
          );
        }
        throw new BadRequestException('A student with conflicting unique fields already exists');
      }
      throw err;
    }

    // Only cache guardian ids once the transaction has actually committed —
    // caching them earlier could hand a later row a reference to a guardian
    // that got rolled back by this row's own failure.
    for (const { phone, id } of guardianResolutions) {
      guardianCache.set(phone, id);
    }

    return studentId;
  }

  private toDtoInput(raw: Record<string, string>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = value === '' ? undefined : value;
    }
    return out;
  }

  private async buildClassSectionMap(tenantId: string): Promise<ClassSectionLookup> {
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
    for (const section of sections) {
      const cls = classById.get(section.class_id);
      if (!cls) continue;
      sectionIdByKey.set(`${cls.name}::${section.section_name}`, section.id);
    }
    return { sectionIdByKey, classNames: new Set(classes.map((c) => c.name)) };
  }

  private async resolveGuardian(
    info: GuardianInput,
    tenantId: string,
    cache: Map<string, string>,
    manager: EntityManager,
    userId: string | undefined,
  ): Promise<string> {
    const cached = cache.get(info.phone);
    if (cached) return cached;

    const existing = await this.guardianService.findByPhone(info.phone, tenantId, manager);
    if (existing) return existing.id;

    const created = await this.guardianService.create(
      { full_name: info.name, phone: info.phone, email: info.email },
      tenantId,
      manager,
      userId ?? null,
    );
    return created.id;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505'
    );
  }

  private violatedColumns(err: unknown): string[] {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail !== 'string') return [];
    const match = /^Key \(([^)]+)\)=/.exec(detail);
    if (!match) return [];
    return match[1].split(',').map((column) => column.trim());
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
