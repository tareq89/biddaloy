import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';

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
  ) {}

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
      // counts while the section is live and in the current academic year.
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
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true AND ay.deleted_at IS NULL',
        { tenantId },
      )
      .select('tcs.assignment_type', 'assignment_type')
      .addSelect('s.id', 'live_subject_id')
      .addSelect('ay.id', 'current_year_id')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id = :sectionId', { sectionId })
      .andWhere('t.user_id = :userId', { userId })
      .getRawMany<{
        assignment_type: TeacherAssignmentType;
        live_subject_id: string | null;
        current_year_id: string | null;
      }>();

    const homeroomTypes = rows
      .filter((r) => r.current_year_id)
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
}
