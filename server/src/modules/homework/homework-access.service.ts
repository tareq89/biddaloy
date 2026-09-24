import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';

/** Roles that may manage homework for every section in the tenant, without
 * going through `teacher_class_sections`. Same tenant-wide set as attendance. */
const TENANT_WIDE_ROLES: string[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT];

/**
 * The object-level "may this caller touch homework for this
 * class/section/subject?" gate — clones `AttendanceAccessService`'s shape
 * (`server/src/modules/attendance/attendance-access.service.ts`).
 *
 * `subject_id = null` means "class teacher" (D17): a class teacher may
 * manage homework for any subject taught in their section, a subject
 * teacher only for their own subject.
 */
@Injectable()
export class HomeworkAccessService {
  constructor(
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /** True for roles that manage homework tenant-wide without a
   * `teacher_class_sections` link (used by callers building their own query,
   * e.g. `HomeworkService.findAll`'s row-level scoping). */
  isTenantWide(role: string): boolean {
    return TENANT_WIDE_ROLES.includes(role);
  }

  /**
   * Throws `ForbiddenException` (403) when the caller may not manage
   * homework for this `(section, subject)` pair, otherwise resolves
   * silently. A section that doesn't map to this teacher and one that
   * doesn't exist in this tenant are indistinguishable — both 403.
   */
  async assertCanManageSection(
    role: string,
    userId: string,
    sectionId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    if (TENANT_WIDE_ROLES.includes(role)) {
      const section = await this.sectionRepo.findOne({
        where: { id: sectionId, tenant_id: tenantId },
      });
      if (!section) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return;
    }

    if (role === UserRole.TEACHER) {
      // Every joined table is filtered on tenant_id, not just the outer
      // query — same belt-and-braces convention as AttendanceAccessService.
      const match = await this.tcsRepo
        .createQueryBuilder('tcs')
        .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
          tenantId,
        })
        .where('tcs.section_id = :sectionId', { sectionId })
        .andWhere('tcs.tenant_id = :tenantId', { tenantId })
        .andWhere('t.user_id = :userId', { userId })
        .andWhere('(tcs.subject_id IS NULL OR tcs.subject_id = :subjectId)', { subjectId })
        .getOne();
      if (!match) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return;
    }

    throw new ForbiddenException('This role cannot manage homework');
  }

  /**
   * Class-level gate for `Homework` itself (no section yet — that's chosen
   * at assign time). A `TEACHER` needs at least one `TeacherClassSection`
   * row for this `class_id`/`subject_id` pair, in any section of that class.
   */
  async assertCanManageClass(
    role: string,
    userId: string,
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    if (TENANT_WIDE_ROLES.includes(role)) {
      return;
    }

    if (role === UserRole.TEACHER) {
      const match = await this.tcsRepo
        .createQueryBuilder('tcs')
        .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
          tenantId,
        })
        .innerJoin('class_sections', 'cs', 'cs.id = tcs.section_id AND cs.tenant_id = :tenantId', {
          tenantId,
        })
        .where('cs.class_id = :classId', { classId })
        .andWhere('tcs.tenant_id = :tenantId', { tenantId })
        .andWhere('t.user_id = :userId', { userId })
        .andWhere('(tcs.subject_id IS NULL OR tcs.subject_id = :subjectId)', { subjectId })
        .getOne();
      if (!match) {
        throw new ForbiddenException('You do not have access to this class');
      }
      return;
    }

    throw new ForbiddenException('This role cannot manage homework');
  }

  /** Resolves a student's `section_id` so a single-student assignment can
   * reuse `assertCanManageSection` against the student's actual section. */
  async assertCanManageStudent(
    role: string,
    userId: string,
    studentId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    if (!student) {
      throw new ForbiddenException('You do not have access to this student');
    }
    await this.assertCanManageSection(role, userId, student.class_section_id, subjectId, tenantId);
  }
}
