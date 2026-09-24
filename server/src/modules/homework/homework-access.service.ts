import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
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
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
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

  /**
   * Read-only counterpart of `assertCanManageSection` for the analytics
   * rollups (D13) — subject-agnostic, since a section rollup aggregates
   * every subject's homework, not just one teacher's own subject. A
   * `TEACHER` may view a section's rollup if they hold *any*
   * `teacher_class_sections` row for it (class teacher or any subject
   * teacher), not just the one matching a specific `subjectId`.
   */
  async assertCanViewSection(
    role: string,
    userId: string,
    sectionId: string,
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
      const match = await this.tcsRepo
        .createQueryBuilder('tcs')
        .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
          tenantId,
        })
        .where('tcs.section_id = :sectionId', { sectionId })
        .andWhere('tcs.tenant_id = :tenantId', { tenantId })
        .andWhere('t.user_id = :userId', { userId })
        .getOne();
      if (!match) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return;
    }

    throw new ForbiddenException('This role cannot view homework analytics');
  }

  /** Read-only, subject-agnostic counterpart of `assertCanManageClass`. */
  async assertCanViewClass(
    role: string,
    userId: string,
    classId: string,
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
        .getOne();
      if (!match) {
        throw new ForbiddenException('You do not have access to this class');
      }
      return;
    }

    throw new ForbiddenException('This role cannot view homework analytics');
  }

  /** Resolves a student's section, then defers to `assertCanViewSection`. */
  async assertCanViewStudent(
    role: string,
    userId: string,
    studentId: string,
    tenantId: string,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    if (!student) {
      throw new ForbiddenException('You do not have access to this student');
    }
    await this.assertCanViewSection(role, userId, student.class_section_id, tenantId);
  }

  /** `Homework.create` takes class_id/subject_id straight from the DTO —
   * confirm both actually belong to this tenant before any teacher-scoping
   * check runs against them, since `assertCanManageClass` short-circuits
   * without a lookup for TENANT_WIDE_ROLES and would otherwise let an ADMIN
   * create homework pointing at another tenant's class/subject id. */
  async assertClassAndSubjectInTenant(
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    const [classOk, subjectOk] = await Promise.all([
      this.classRepo.exist({ where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() } }),
      this.subjectRepo.exist({
        where: { id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
      }),
    ]);
    if (!classOk) {
      throw new ForbiddenException('You do not have access to this class');
    }
    if (!subjectOk) {
      throw new ForbiddenException('You do not have access to this subject');
    }
  }

  /** 400 when the assign target (a section, or a student's own section)
   * isn't actually in the given homework's class — the analytics rollups
   * key on `homework.class_id`, so a target from a different class would
   * silently corrupt them rather than fail loudly. */
  async assertTargetInClass(
    sectionId: string | null | undefined,
    studentId: string | null | undefined,
    classId: string,
    tenantId: string,
  ): Promise<void> {
    let targetSectionId = sectionId ?? null;
    if (!targetSectionId && studentId) {
      const student = await this.studentRepo.findOne({
        where: { id: studentId, tenant_id: tenantId },
      });
      targetSectionId = student?.class_section_id ?? null;
    }
    const inClass =
      !!targetSectionId &&
      (await this.sectionRepo.exist({
        where: { id: targetSectionId, class_id: classId, tenant_id: tenantId },
      }));
    if (!inClass) {
      throw new BadRequestException("The assignment target is not in this homework's class");
    }
  }
}
