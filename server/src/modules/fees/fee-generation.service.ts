import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, FindOptionsWhere } from 'typeorm';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { FeeStructureStudent } from './entities/fee-structure-student.entity';
import { StudentFee } from './entities/student-fee.entity';
import { EnrollmentStatus, FeeApplicability, FeeStatus, PeriodType } from '@biddaloy/shared';
import { GenerateStudentFeesDto, GenerateFeesResultDto } from './dto/fees.dto';

/**
 * Turns FeeStructure templates into per-student StudentFee obligations for
 * a given (academic_year, month, year).
 *
 * Recurring structures (is_recurring=true) match when target.month >=
 * structure.month — `month` is an effective-from marker, not a single
 * fixed month. One-time structures match only on an exact month.
 */
@Injectable()
export class FeeGenerationService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
    @InjectRepository(FeeStructureStudent)
    private readonly fssRepo: Repository<FeeStructureStudent>,
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
  ) {}

  async generate(dto: GenerateStudentFeesDto, tenantId: string): Promise<GenerateFeesResultDto> {
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }
    this.assertMonthWithinAcademicYear(dto, academicYear);

    if (dto.class_id) {
      const cls = await this.classRepo.findOne({
        where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!cls) {
        throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
      }
    }

    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: {
          id: dto.section_id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
          ...(dto.class_id ? { class_id: dto.class_id } : {}),
        },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found`);
      }
    }

    const students = await this.findEligibleStudents(dto, tenantId);
    if (students.length === 0) {
      return { generated: 0, skipped: 0, students_evaluated: 0 };
    }

    const applicableStructures = await this.findApplicableStructures(dto, tenantId);
    if (applicableStructures.length === 0) {
      return { generated: 0, skipped: 0, students_evaluated: students.length };
    }

    const selectedStudentsByStructure = await this.loadSelectedStudentLinks(applicableStructures);

    const candidates = students.flatMap((student) =>
      this.buildCandidates(student, dto, applicableStructures, selectedStudentsByStructure),
    );

    if (candidates.length === 0) {
      return { generated: 0, skipped: 0, students_evaluated: students.length };
    }

    const generated = await this.bulkInsertIdempotent(candidates);

    return {
      generated,
      skipped: candidates.length - generated,
      students_evaluated: students.length,
    };
  }

  private assertMonthWithinAcademicYear(
    dto: GenerateStudentFeesDto,
    academicYear: AcademicYear,
  ): void {
    const target = Date.UTC(dto.year, dto.month - 1, 1);
    const start = new Date(academicYear.start_date);
    const end = new Date(academicYear.end_date);
    const startMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const endMonth = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);

    if (target < startMonth || target > endMonth) {
      throw new BadRequestException(
        `Month ${dto.month}/${dto.year} is outside academic year "${academicYear.name}" ` +
          `(${academicYear.start_date} to ${academicYear.end_date})`,
      );
    }
  }

  private async findEligibleStudents(
    dto: GenerateStudentFeesDto,
    tenantId: string,
  ): Promise<Student[]> {
    const where: FindOptionsWhere<Student> = {
      tenant_id: tenantId,
      deleted_at: IsNull(),
      enrollment_status: EnrollmentStatus.ACTIVE,
    };
    if (dto.class_id || dto.section_id) {
      where.class_section = {
        ...(dto.class_id ? { class_id: dto.class_id } : {}),
        ...(dto.section_id ? { id: dto.section_id } : {}),
      };
    }

    return this.studentRepo.find({ where, relations: ['class_section'] });
  }

  private async findApplicableStructures(
    dto: GenerateStudentFeesDto,
    tenantId: string,
  ): Promise<FeeStructure[]> {
    const where: FindOptionsWhere<FeeStructure> = {
      tenant_id: tenantId,
      academic_year_id: dto.academic_year_id,
      deleted_at: IsNull(),
    };
    if (dto.class_id) where.class_id = dto.class_id;

    const structures = await this.feeStructureRepo.find({ where });

    return structures.filter((structure) =>
      structure.is_recurring ? dto.month >= structure.month : dto.month === structure.month,
    );
  }

  private async loadSelectedStudentLinks(
    structures: FeeStructure[],
  ): Promise<Map<string, Set<string>>> {
    const selectedStructureIds = structures
      .filter((s) => s.applicability === FeeApplicability.SELECTED)
      .map((s) => s.id);

    const byStructure = new Map<string, Set<string>>();
    if (selectedStructureIds.length === 0) {
      return byStructure;
    }

    const links = await this.fssRepo.find({
      where: { fee_structure_id: In(selectedStructureIds) },
    });
    for (const link of links) {
      if (!byStructure.has(link.fee_structure_id)) {
        byStructure.set(link.fee_structure_id, new Set());
      }
      byStructure.get(link.fee_structure_id)!.add(link.student_id);
    }
    return byStructure;
  }

  /**
   * One candidate row per applicable fee structure, not a single summed
   * row — `student_fees` is now one bill per student × fee structure ×
   * period (16.1.3). This is a minimal compile-only adaptation to the new
   * columns; the real generation rewrite (schedules, discounts, dedup
   * strategies) is 16.3.1.
   */
  private buildCandidates(
    student: Student,
    dto: GenerateStudentFeesDto,
    structures: FeeStructure[],
    selectedStudentsByStructure: Map<string, Set<string>>,
  ): Partial<StudentFee>[] {
    const classId = student.class_section.class_id;
    const sectionId = student.class_section_id;
    // First day of the target month — `period_start` is a date, `month`/
    // `year` are now generated columns derived from it.
    const periodStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));

    const candidates: Partial<StudentFee>[] = [];
    for (const structure of structures) {
      if (structure.class_id !== classId) continue;
      if (structure.section_id && structure.section_id !== sectionId) continue;
      if (structure.applicability === FeeApplicability.SELECTED) {
        const allowed = selectedStudentsByStructure.get(structure.id);
        if (!allowed?.has(student.id)) continue;
      }
      const amount = Number(structure.amount);
      // student_fees has CHECK (total_amount > 0) — nothing to charge, nothing to insert.
      if (amount <= 0) continue;

      candidates.push({
        student_id: student.id,
        academic_year_id: dto.academic_year_id,
        fee_structure_id: structure.id,
        period_start: periodStart,
        period_type: PeriodType.MONTH,
        total_amount: amount,
        status: FeeStatus.PENDING,
      });
    }

    return candidates;
  }

  // 7 bound params per candidate row (student_id, academic_year_id,
  // fee_structure_id, period_start, period_type, total_amount, status);
  // Postgres caps a single statement at 65,535 params (~9.4k rows at 7
  // each). 1000 stays comfortably under that for any single
  // class/school-wide generation run.
  private static readonly INSERT_BATCH_SIZE = 1000;

  /**
   * Relies on the (student_id, fee_structure_id, period_start, occurrence)
   * unique constraint as an ON CONFLICT DO NOTHING guard — idempotent under
   * re-runs and safe against two concurrent generation requests racing
   * each other.
   */
  private async bulkInsertIdempotent(candidates: Partial<StudentFee>[]): Promise<number> {
    let generated = 0;
    for (let i = 0; i < candidates.length; i += FeeGenerationService.INSERT_BATCH_SIZE) {
      const batch = candidates.slice(i, i + FeeGenerationService.INSERT_BATCH_SIZE);
      const result = await this.studentFeeRepo
        .createQueryBuilder()
        .insert()
        .into(StudentFee)
        .values(batch)
        .orIgnore()
        .returning(['id'])
        .execute();
      generated += result.raw.length;
    }
    return generated;
  }
}
