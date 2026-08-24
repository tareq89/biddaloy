import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, EntityManager } from 'typeorm';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CreateEnrollmentDto, UpdateEnrollmentDto } from './dto/enrollments.dto';
import { EnrollmentStatus } from '@biddaloy/shared';
import { nextRollNumber } from '../students/roll-number.util';

@Injectable()
export class EnrollmentService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly repo: Repository<Enrollment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
  ) {}

  async create(dto: CreateEnrollmentDto, tenantId: string): Promise<Enrollment> {
    // Verify student exists and belongs to tenant via class_section -> class chain
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }

    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
    }

    // Verify academic year exists for tenant
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    // Verify section exists and belongs to tenant/class when provided
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: {
          id: dto.section_id,
          class_id: dto.class_id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found in this class`);
      }
    }

    // Check for duplicate active enrollment
    const existing = await this.repo.findOne({
      where: {
        student_id: dto.student_id,
        academic_year_id: dto.academic_year_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Student is already actively enrolled in academic year "${dto.academic_year_id}"`,
      );
    }

    // [8.11.3] `create()` always defaults to ACTIVE (this DTO has no
    // `enrollment_status` field), so a `section_id` here always means the
    // student is physically placed there — sync `Student.class_section_id`
    // (and reassign the target section's roll number) inside the same
    // transaction as the insert, so a rollback undoes both.
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Enrollment);
      const entity = repo.create({
        student_id: dto.student_id,
        class_id: dto.class_id,
        section_id: dto.section_id ?? null,
        academic_year_id: dto.academic_year_id,
        tenant_id: tenantId,
      });
      const saved = await repo.save(entity);

      if (saved.section_id) {
        await this.syncStudentPlacement(manager, saved.student_id, saved.section_id, tenantId);
      }

      return saved;
    });
  }

  async findByStudent(studentId: string, tenantId: string) {
    // Verify student exists and belongs to tenant
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    return this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId },
      relations: ['class', 'section', 'academic_year'],
      order: { enrolled_at: 'DESC' },
    });
  }

  async findCurrentByStudent(studentId: string, tenantId: string): Promise<Enrollment | null> {
    // Verify student exists and belongs to tenant
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    return this.repo.findOne({
      where: {
        student_id: studentId,
        tenant_id: tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: ['class', 'section', 'academic_year'],
    });
  }

  async update(id: string, dto: UpdateEnrollmentDto, tenantId: string): Promise<Enrollment> {
    const enrollment = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['class', 'section'],
    });
    if (!enrollment) {
      throw new NotFoundException(`Enrollment with ID "${id}" not found`);
    }

    // Verify the enrollment's class belongs to this tenant
    if (enrollment.class.tenant_id !== tenantId) {
      throw new NotFoundException(`Enrollment with ID "${id}" not found`);
    }

    const classChanging = dto.class_id !== undefined && dto.class_id !== enrollment.class_id;

    // Validate the new class if the caller is moving it — [8.11.3]. Also
    // enforced: the new class must belong to the *same* academic year as
    // this enrollment row. `academic_year_id` isn't patchable (this DTO
    // has no such field — a year change is a new enrollment, i.e.
    // promotion, not this "move class" flow), so a class from a different
    // year would leave `class_id` and `academic_year_id` pointing at two
    // different years on the same row.
    if (classChanging) {
      const cls = await this.classRepo.findOne({
        where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!cls) {
        throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
      }
      if (cls.academic_year_id !== enrollment.academic_year_id) {
        throw new BadRequestException(
          'class_id must belong to the same academic year as this enrollment',
        );
      }
    }

    // A section belongs to exactly one class, so moving the class without
    // also naming the section it belongs to would leave `section_id`
    // pointing at a section that isn't actually part of the new class.
    if (classChanging && !dto.section_id) {
      throw new BadRequestException('section_id is required when changing class_id');
    }

    // Validate section_id against the *target* class (the new one if
    // changing, otherwise the enrollment's current class).
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: {
          id: dto.section_id,
          class_id: dto.class_id ?? enrollment.class_id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found in this class`);
      }
    }

    const targetSectionId = dto.section_id ?? enrollment.section_id;
    const targetStatus = dto.enrollment_status ?? enrollment.enrollment_status;

    // [8.11.3] Reactivating an older row (e.g. an INACTIVE/TRANSFERRED one)
    // back to ACTIVE must not leave two ACTIVE rows for the same student
    // and academic year — `findCurrentByStudent` picks whichever one it
    // finds first, and `IDX_enr_active_student_year` (a unique partial
    // index) already rejects this at the database level. Pre-checking
    // here just turns that into a clean 409 instead of a raw DB error.
    if (targetStatus === EnrollmentStatus.ACTIVE) {
      const conflictingActive = await this.repo.findOne({
        where: {
          student_id: enrollment.student_id,
          academic_year_id: enrollment.academic_year_id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          id: Not(id),
        },
      });
      if (conflictingActive) {
        throw new ConflictException(
          `Student is already actively enrolled in academic year "${enrollment.academic_year_id}"`,
        );
      }
    }

    // [8.11.3] A "move" only happens when the resulting row is ACTIVE and
    // resolves to a concrete section — `Student.class_section_id` can
    // never be null, so there's nothing to sync it to otherwise. A
    // status-only patch (e.g. marking a row GRADUATED, no class/section
    // given) never touches the student row.
    const shouldSyncStudent = targetStatus === EnrollmentStatus.ACTIVE && !!targetSectionId;

    if (shouldSyncStudent) {
      await this.repo.manager.transaction(async (manager) => {
        await manager.getRepository(Enrollment).update({ id, tenant_id: tenantId }, dto);
        await this.syncStudentPlacement(manager, enrollment.student_id, targetSectionId!, tenantId);
      });
    } else {
      await this.repo.update({ id, tenant_id: tenantId }, dto);
    }

    return this.repo.findOne({
      where: { id },
      relations: ['class', 'section', 'academic_year'],
    }) as Promise<Enrollment>;
  }

  /**
   * Points `Student.class_section_id` at `targetSectionId` and reassigns
   * its roll number in that section — the side effect that makes an
   * `Enrollment` write an actual "move," not just a history row (rosters,
   * fee assignment, and roll-number uniqueness all key off
   * `Student.class_section_id`, never `Enrollment` — see [8.11.3]'s plan
   * note). No-ops when the student is already placed there (e.g.
   * `StudentService.create`'s day-one enrollment, or re-activating a row
   * that already matches), so it never bumps a student's own roll number
   * against themselves.
   */
  private async syncStudentPlacement(
    manager: EntityManager,
    studentId: string,
    targetSectionId: string,
    tenantId: string,
  ): Promise<void> {
    const studentRepo = manager.getRepository(Student);
    const student = await studentRepo.findOne({ where: { id: studentId, tenant_id: tenantId } });
    if (!student || student.class_section_id === targetSectionId) {
      return;
    }

    const rollNumber = await nextRollNumber(manager, targetSectionId, tenantId);
    await studentRepo.update(
      { id: studentId, tenant_id: tenantId },
      { class_section_id: targetSectionId, roll_number: rollNumber },
    );
  }
}
