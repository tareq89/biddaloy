import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { StudentService, GuardianService } from './students.service';
import { parseSpreadsheet, BulkUploadParseError, ParsedRow } from './bulk-upload.parser';
import { BulkUploadRowDto, BulkUploadResultDto } from './dto/students.dto';
import { AuditAction, CommunicationMedium } from '@beton-boi/shared';

interface GuardianInput {
  name: string;
  phone: string;
  email?: string;
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
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
  ) {}

  async process(
    file: Express.Multer.File | undefined,
    tenantId: string,
    userId: string | undefined,
  ): Promise<BulkUploadResultDto> {
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

    const classSectionMap = await this.buildClassSectionMap(tenantId);

    const errors: { row: number; reason: string }[] = [];
    const createdStudentIds: string[] = [];
    const guardianCache = new Map<string, string>();
    const rollsSeenThisRequest = new Map<string, Set<number>>();

    for (const parsed of rows) {
      try {
        const studentId = await this.processRow(parsed, tenantId, classSectionMap, guardianCache, rollsSeenThisRequest);
        createdStudentIds.push(studentId);
      } catch (err) {
        errors.push({ row: parsed.rowNumber, reason: this.describeError(err) });
      }
    }

    await this.auditLogRepo.save(
      this.auditLogRepo.create({
        action: AuditAction.BULK_UPLOAD,
        entity_type: 'Student',
        performed_by_user_id: userId ?? null,
        new_values: {
          filename: file.originalname,
          total_rows: rows.length,
          success_count: createdStudentIds.length,
          error_count: errors.length,
        },
      }),
    );

    return {
      total_rows: rows.length,
      success_count: createdStudentIds.length,
      error_count: errors.length,
      created_student_ids: createdStudentIds,
      errors,
    };
  }

  private async processRow(
    parsed: ParsedRow,
    tenantId: string,
    classSectionMap: Map<string, string>,
    guardianCache: Map<string, string>,
    rollsSeenThisRequest: Map<string, Set<number>>,
  ): Promise<string> {
    const dto = plainToInstance(BulkUploadRowDto, this.toDtoInput(parsed.values));
    const validationErrors = await validate(dto);
    if (validationErrors.length > 0) {
      const messages = validationErrors.flatMap((e) => Object.values(e.constraints ?? {}));
      throw new BadRequestException(messages.join('; '));
    }

    const sectionKey = `${dto.class}::${dto.section}`;
    const classSectionId = classSectionMap.get(sectionKey);
    if (!classSectionId) {
      throw new BadRequestException(
        `Class '${dto.class}' / Section '${dto.section}' not found for the current academic year`,
      );
    }

    let rollNumber: number | undefined;
    if (dto.roll) {
      rollNumber = parseInt(dto.roll, 10);
      const seen = rollsSeenThisRequest.get(classSectionId) ?? new Set<number>();
      if (seen.has(rollNumber)) {
        throw new BadRequestException(
          `Duplicate roll number ${rollNumber} in class '${dto.class}' section '${dto.section}' (already used earlier in this file)`,
        );
      }
    }

    const guardianIds: string[] = [];
    guardianIds.push(
      await this.resolveGuardian(
        { name: dto.guardian1_name, phone: dto.guardian1_phone, email: dto.guardian1_email },
        tenantId,
        guardianCache,
      ),
    );
    if (dto.guardian2_name) {
      guardianIds.push(
        await this.resolveGuardian(
          { name: dto.guardian2_name, phone: dto.guardian2_phone as string, email: dto.guardian2_email },
          tenantId,
          guardianCache,
        ),
      );
    }

    let student;
    try {
      student = await this.studentService.create(
        {
          full_name: dto.student_name,
          class_section_id: classSectionId,
          roll_number: rollNumber,
          home_address: dto.home_address,
          preferred_communication: dto.preferred_communication as CommunicationMedium,
          guardian_ids: guardianIds,
        },
        tenantId,
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new BadRequestException(
          rollNumber !== undefined
            ? `Duplicate roll number ${rollNumber} in class '${dto.class}' section '${dto.section}'`
            : 'A student with conflicting unique fields already exists',
        );
      }
      throw err;
    }

    if (rollNumber !== undefined) {
      const seen = rollsSeenThisRequest.get(classSectionId) ?? new Set<number>();
      seen.add(rollNumber);
      rollsSeenThisRequest.set(classSectionId, seen);
    }

    return student.id;
  }

  private toDtoInput(raw: Record<string, string>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = value === '' ? undefined : value;
    }
    return out;
  }

  private async buildClassSectionMap(tenantId: string): Promise<Map<string, string>> {
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
    const map = new Map<string, string>();
    for (const section of sections) {
      const cls = classById.get(section.class_id);
      if (!cls) continue;
      map.set(`${cls.name}::${section.section_name}`, section.id);
    }
    return map;
  }

  private async resolveGuardian(
    info: GuardianInput,
    tenantId: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(info.phone);
    if (cached) return cached;

    const existing = await this.guardianService.findByPhone(info.phone, tenantId);
    if (existing) {
      cache.set(info.phone, existing.id);
      return existing.id;
    }

    const created = await this.guardianService.create(
      { full_name: info.name, phone: info.phone, email: info.email },
      tenantId,
    );
    cache.set(info.phone, created.id);
    return created.id;
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505';
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
