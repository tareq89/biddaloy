import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RoleScope, TeacherAssignmentType, roleScope } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';

/**
 * [X-07] SQL scalar: the start_date of the academic year right before the tenant's current one
 * (latest start before the current year's). The homeroom grant and the marks-overdue alerts both
 * use it, so they cover the same years: current, or this prior one. `tenant` is the SQL
 * parameter for the tenant id (`:tenantId` or `$1`).
 */
export function priorYearStartSql(tenant: string): string {
  return `(SELECT max(p.start_date) FROM academic_years p
    JOIN academic_years cur ON cur.tenant_id = ${tenant} AND cur.is_current = true AND cur.deleted_at IS NULL
    WHERE p.tenant_id = ${tenant} AND p.deleted_at IS NULL AND p.start_date < cur.start_date)`;
}

export type HomeroomType =
  TeacherAssignmentType.CLASS_TEACHER | TeacherAssignmentType.ASSISTANT_CLASS_TEACHER;

export interface HomeroomSectionRow {
  section_id: string;
  section_name: string;
  class_id: string;
  class_name: string;
  assignment_type: HomeroomType;
}

const HOMEROOM_TYPES: HomeroomType[] = [
  TeacherAssignmentType.CLASS_TEACHER,
  TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
];

/**
 * "What is this user's role in this section?" — the one place for new call sites that joins
 * user -> `teachers.user_id` -> `teacher_class_sections` (the JWT carries a
 * **user** id, not a teacher id). Every table is filtered on `tenant_id`.
 *
 * It only answers for the teacher's own rows. Tenant-wide roles never reach
 * it: callers short-circuit with `hasTenantDataScope` first (D29), so no
 * role list lives here.
 */
@Injectable()
export class TeacherScopeService {
  constructor(
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /** Distinct sections the user teaches: live homeroom (current year) or live-subject rows. */
  async sectionIds(input: { userId: string; tenantId: string }): Promise<string[]> {
    const { userId, tenantId } = input;
    const rows = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'academic_years',
        'ay',
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true AND ay.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'subjects',
        's',
        's.id = tcs.subject_id AND s.tenant_id = :tenantId AND s.deleted_at IS NULL',
        { tenantId },
      )
      .select('DISTINCT tcs.section_id', 'section_id')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('t.user_id = :userId', { userId })
      .andWhere(
        `((tcs.assignment_type IN (:...homeroom) AND ay.id IS NOT NULL)
          OR (tcs.assignment_type = :subjectType AND s.id IS NOT NULL))`,
        { homeroom: HOMEROOM_TYPES, subjectType: TeacherAssignmentType.SUBJECT_TEACHER },
      )
      .getRawMany<{ section_id: string }>();
    return rows.map((r) => r.section_id);
  }

  /** `null` = no extra filter (tenant-scope and guardian roles); array = ASSIGNED_SECTIONS.
   * An unknown role sees nothing (`[]`), per `roleScope`'s contract. */
  async sectionScope(input: {
    role: string;
    userId: string;
    tenantId: string;
  }): Promise<string[] | null> {
    const scope = roleScope(input.role);
    if (scope === null) return [];
    if (scope !== RoleScope.ASSIGNED_SECTIONS) return null;
    return this.sectionIds(input);
  }

  /** 403 unless the student's current section is in the caller's scope (missing student = 403 too). */
  async assertCanSeeStudent(input: {
    role: string;
    userId: string;
    tenantId: string;
    studentId: string;
  }): Promise<void> {
    const scope = await this.sectionScope(input);
    if (scope === null) return;
    const student = await this.studentRepo.findOne({
      where: { id: input.studentId, tenant_id: input.tenantId, deleted_at: IsNull() },
      select: { id: true, class_section_id: true },
    });
    if (!student?.class_section_id || !scope.includes(student.class_section_id)) {
      throw new ForbiddenException("You do not teach this student's section.");
    }
  }

  /**
   * `homeroom` is the caller's CLASS/ASSISTANT row for the section (a teacher
   * holds at most one, by `UQ_tcs_teacher_section_homeroom`). `subjectIds`
   * holds only **live** subjects (D16): a soft-deleted subject drops out, so
   * its teacher loses read and write on it.
   */
  async rolesInSection(input: {
    userId: string;
    tenantId: string;
    sectionId: string;
  }): Promise<{ homeroom: HomeroomType | null; subjectIds: string[] }> {
    const { userId, tenantId, sectionId } = input;
    const rows = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'subjects',
        's',
        's.id = tcs.subject_id AND s.tenant_id = :tenantId AND s.deleted_at IS NULL',
        { tenantId },
      )
      // Homeroom (CLASS/ASSISTANT) grants a read of EVERY subject, so it only
      // counts while the section is live and in the current academic year, or in
      // the year right before it (latest start_date before the current year's)
      // while that class still has a DRAFT exam [X-07]: marks entry outlives the
      // year flag. DRAFT only, and the same two years (`priorYearStartSql`) as the
      // marks-overdue alert, so the grant ends when the alert clears; older and
      // future years never qualify for either. Trade-off: the grant then covers every homeroom-gated read, not
      // only marks; narrow it to marks reads if that ever matters.
      // SUBJECT_TEACHER rows keep their existing (year-agnostic) behaviour.
      .leftJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .leftJoin(
        'academic_years',
        'ay',
        `ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.deleted_at IS NULL AND (
          ay.is_current = true
          OR (
            ay.start_date = ${priorYearStartSql(':tenantId')}
            AND EXISTS (SELECT 1 FROM exams e WHERE e.tenant_id = :tenantId AND e.class_id = c.id AND e.academic_year_id = ay.id AND e.deleted_at IS NULL AND e.status = 'DRAFT')
          )
        )`,
        { tenantId },
      )
      .select('tcs.assignment_type', 'assignment_type')
      .addSelect('s.id', 'live_subject_id')
      .addSelect('ay.id', 'homeroom_year_id')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id = :sectionId', { sectionId })
      .andWhere('t.user_id = :userId', { userId })
      .getRawMany<{
        assignment_type: TeacherAssignmentType;
        live_subject_id: string | null;
        homeroom_year_id: string | null;
      }>();

    const homeroomTypes = rows
      .filter((r) => r.homeroom_year_id)
      .map((r) => r.assignment_type)
      .filter((type): type is HomeroomType => HOMEROOM_TYPES.includes(type as HomeroomType));
    // CLASS_TEACHER wins if (impossibly, per the unique index) both appear.
    const homeroom = homeroomTypes.includes(TeacherAssignmentType.CLASS_TEACHER)
      ? TeacherAssignmentType.CLASS_TEACHER
      : (homeroomTypes[0] ?? null);
    const subjectIds = rows
      .filter(
        (r) => r.assignment_type === TeacherAssignmentType.SUBJECT_TEACHER && r.live_subject_id,
      )
      .map((r) => r.live_subject_id as string);

    return { homeroom, subjectIds };
  }

  /** The caller's CLASS/ASSISTANT sections in the **current** academic year,
   * skipping soft-deleted sections/classes, ordered class then section. */
  async homeroomSections(input: {
    userId: string;
    tenantId: string;
  }): Promise<HomeroomSectionRow[]> {
    const { userId, tenantId } = input;
    // numeric_grade first: by name alone "Class 10" sorts before "Class 6".
    return this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'academic_years',
        'ay',
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true AND ay.deleted_at IS NULL',
        { tenantId },
      )
      .select('cs.id', 'section_id')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('c.id', 'class_id')
      .addSelect('c.name', 'class_name')
      .addSelect('tcs.assignment_type', 'assignment_type')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.assignment_type IN (:...types)', { types: HOMEROOM_TYPES })
      .andWhere('t.user_id = :userId', { userId })
      .orderBy('c.numeric_grade', 'ASC', 'NULLS LAST')
      .addOrderBy('c.name', 'ASC')
      .addOrderBy('cs.section_name', 'ASC')
      .getRawMany<HomeroomSectionRow>();
  }

  /** True when the user holds a live SUBJECT_TEACHER row for `subjectId` in any
   *  live section of live `classId`. Homeroom rows never count (write rule, like marks). */
  async teachesSubjectInClass(input: {
    userId: string;
    tenantId: string;
    classId: string;
    subjectId: string;
  }): Promise<boolean> {
    const { userId, tenantId, classId, subjectId } = input;
    return this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = tcs.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'classes',
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
        { tenantId },
      )
      .innerJoin(
        'subjects',
        's',
        's.id = tcs.subject_id AND s.tenant_id = :tenantId AND s.deleted_at IS NULL',
        { tenantId },
      )
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.assignment_type = :type', { type: TeacherAssignmentType.SUBJECT_TEACHER })
      .andWhere('tcs.subject_id = :subjectId', { subjectId })
      .andWhere('cs.class_id = :classId', { classId })
      .andWhere('t.user_id = :userId', { userId })
      .getExists();
  }
}
