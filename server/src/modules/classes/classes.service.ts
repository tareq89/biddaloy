import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { EnrollmentStatus, TeacherDesignation } from '@biddaloy/shared';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import {
  CreateClassDto,
  UpdateClassDto,
  QueryClassDto,
  CreateSectionDto,
  UpdateSectionDto,
} from './dto/classes.dto';

/** [8.11.2] — `SectionService.findAll`'s per-section enrolled count, so the
 * classes list's inline expansion can show it without an extra request per
 * section. Plain TS interface, same convention `AcademicYearStats` (8.11.1)
 * set: `classes.controller.ts` has no `@ApiResponse` decorations, so there
 * is nothing for a DTO class to generate into `schema.d.ts` anyway. */
export type ClassSectionWithCount = ClassSection & { enrolled_count: number };

/** [8.11.2] — `ClassService.findAll`'s per-class section/student totals,
 * computed server-side (two grouped queries, not N+1) so the classes
 * list's Sections/Students columns don't each need a client-side
 * `useClassSections(classId)` per row — that was 10 concurrent
 * `GET /classes/:id/sections` requests just to sum a page's worth of
 * rows. Same plain-TS-interface convention as `ClassSectionWithCount`
 * above. */
export type ClassWithCounts = Class & { section_count: number; student_count: number };

/** [8.11.2] — `SectionService.findTeachers`'s response shape: one row per
 * distinct teacher assigned to any section of the class, with every
 * section name they teach folded onto that one row (a teacher can hold
 * more than one section). Read-only projection — teacher CRUD is #177, so
 * this only carries what the class detail page's Teachers tab needs. */
export interface ClassTeacher {
  id: string;
  employee_id: string;
  full_name: string;
  designations: TeacherDesignation[];
  section_names: string[];
}

@Injectable()
export class ClassService {
  constructor(
    @InjectRepository(Class)
    private readonly repo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async create(dto: CreateClassDto, tenantId: string): Promise<Class> {
    const entity = this.repo.create({
      name: dto.name,
      numeric_grade: dto.numeric_grade,
      academic_year_id: dto.academic_year_id,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(
    query: QueryClassDto,
    tenantId: string,
  ): Promise<{
    data: ClassWithCounts[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.academic_year_id) {
      where.academic_year_id = query.academic_year_id;
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip,
      take: limit,
    });

    // Two grouped queries for this page's worth of classes, not N+1 per
    // class (and not one client-side request per row either — the list
    // page used to mount `useClassSections(classId)` per row just to sum
    // `enrolled_count`, which was 10 concurrent
    // `GET /classes/:id/sections` requests on a full page). Same
    // reasoning as `SectionService.findAll`'s own grouped count.
    const classIds = data.map((cls) => cls.id);
    const sectionCounts =
      classIds.length === 0
        ? []
        : await this.sectionRepo
            .createQueryBuilder('section')
            .select('section.class_id', 'class_id')
            .addSelect('COUNT(*)', 'count')
            .where('section.class_id IN (:...classIds)', { classIds })
            .andWhere('section.tenant_id = :tenantId', { tenantId })
            .andWhere('section.deleted_at IS NULL')
            .groupBy('section.class_id')
            .getRawMany<{ class_id: string; count: string }>();
    const studentCounts =
      classIds.length === 0
        ? []
        : await this.studentRepo
            .createQueryBuilder('student')
            .innerJoin('student.class_section', 'class_section')
            .select('class_section.class_id', 'class_id')
            .addSelect('COUNT(*)', 'count')
            .where('class_section.class_id IN (:...classIds)', { classIds })
            .andWhere('student.tenant_id = :tenantId', { tenantId })
            .andWhere('student.deleted_at IS NULL')
            .andWhere('student.enrollment_status = :status', { status: EnrollmentStatus.ACTIVE })
            .groupBy('class_section.class_id')
            .getRawMany<{ class_id: string; count: string }>();

    const sectionCountByClass = new Map(
      sectionCounts.map((row) => [row.class_id, Number(row.count)]),
    );
    const studentCountByClass = new Map(
      studentCounts.map((row) => [row.class_id, Number(row.count)]),
    );

    const dataWithCounts: ClassWithCounts[] = data.map((cls) => ({
      ...cls,
      section_count: sectionCountByClass.get(cls.id) ?? 0,
      student_count: studentCountByClass.get(cls.id) ?? 0,
    }));

    return { data: dataWithCounts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Class> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['sections', 'academic_year'],
    });
    if (!entity) {
      throw new NotFoundException(`Class with ID "${id}" not found`);
    }
    return entity;
  }

  async update(id: string, dto: UpdateClassDto, tenantId: string): Promise<Class> {
    await this.findOne(id, tenantId);
    await this.repo.update({ id, tenant_id: tenantId }, dto);
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Check for active students in this class first, before the section
    // guard below, so the more meaningful "students are still enrolled"
    // reason wins when both are true — the AC's own "explanation why".
    //
    // `Student` (joined through `class_section`), not `Enrollment`, is the
    // authoritative source here: `POST /students` (`students.service.ts`)
    // only ever writes a `Student` row with `class_section_id` — it never
    // creates an `Enrollment` row, so `Enrollment` reads 0 for the normal
    // student-creation flow and this guard would never fire. `Enrollment`
    // rows only exist via the separate `POST /enrollments` endpoint.
    // `academic-year.service.ts`'s `getStats` keeps counting `Enrollment`
    // — that is pre-existing 8.11.1 behaviour, out of scope to re-base
    // here, and is flagged in the PR description as a known
    // inconsistency for a follow-up issue.
    const activeStudentCount = await this.studentRepo
      .createQueryBuilder('student')
      .innerJoin('student.class_section', 'class_section')
      .where('class_section.class_id = :classId', { classId: id })
      .andWhere('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL')
      .andWhere('student.enrollment_status = :status', { status: EnrollmentStatus.ACTIVE })
      .getCount();
    if (activeStudentCount > 0) {
      throw new ConflictException(
        `Cannot delete class "${id}": ${activeStudentCount} student(s) are still enrolled in it. Move or unenroll them first.`,
      );
    }

    // Check for child sections
    const childSectionCount = await this.sectionRepo.count({
      where: { class_id: id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (childSectionCount > 0) {
      throw new ConflictException(
        `Cannot delete class "${id}": ${childSectionCount} section(s) still exist. Remove all sections first.`,
      );
    }

    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}

@Injectable()
export class SectionService {
  constructor(
    @InjectRepository(ClassSection)
    private readonly repo: Repository<ClassSection>,
    @InjectRepository(Class)
    private classRepo: Repository<Class>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(TeacherClassSection)
    private readonly teacherClassSectionRepo: Repository<TeacherClassSection>,
  ) {}

  async create(classId: string, dto: CreateSectionDto, tenantId: string): Promise<ClassSection> {
    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    const entity = this.repo.create({
      class_id: classId,
      section_name: dto.section_name,
      capacity: dto.capacity ?? null,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(classId: string, tenantId: string): Promise<ClassSectionWithCount[]> {
    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    const sections = await this.repo.find({
      where: { class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
      order: { section_name: 'ASC' },
    });

    // One grouped query for every section's enrolled count, not N+1 per
    // section. `Student` (not `Enrollment`) is authoritative here — see
    // the comment on `ClassService.remove` above for why: `POST /students`
    // never writes an `Enrollment` row, so an `Enrollment`-based count
    // would always read 0 for students created the normal way.
    const counts =
      sections.length === 0
        ? []
        : await this.studentRepo
            .createQueryBuilder('student')
            .innerJoin('student.class_section', 'class_section')
            .select('student.class_section_id', 'section_id')
            .addSelect('COUNT(*)', 'count')
            .where('class_section.class_id = :classId', { classId })
            .andWhere('student.tenant_id = :tenantId', { tenantId })
            .andWhere('student.deleted_at IS NULL')
            .andWhere('student.enrollment_status = :status', { status: EnrollmentStatus.ACTIVE })
            .groupBy('student.class_section_id')
            .getRawMany<{ section_id: string; count: string }>();
    const countBySection = new Map(counts.map((row) => [row.section_id, Number(row.count)]));

    return sections.map((section) => ({
      ...section,
      enrolled_count: countBySection.get(section.id) ?? 0,
    }));
  }

  /** [8.11.2] — class detail page's Teachers tab. Distinct teachers with a
   * `teacher_class_sections` row on any (non-deleted) section of this
   * class, each carrying every section name they teach. Read-only: teacher
   * CRUD is #177, this only reads what the tab needs. */
  async findTeachers(classId: string, tenantId: string): Promise<ClassTeacher[]> {
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    // `getMany()` (entity rows), not `getRawMany()` — TypeORM only runs a
    // column's enum-array transform when hydrating an entity. Selecting
    // `teacher.designations` as a raw column instead returns node-postgres's
    // untransformed text form of the array (e.g. `"{CLASS_TEACHER,
    // HEAD_TEACHER}"`, a string, not a `TeacherDesignation[]`), which broke
    // `teachers-tab.tsx`'s `.map()` over it for any teacher with a
    // designation.
    const rows = await this.teacherClassSectionRepo
      .createQueryBuilder('tcs')
      .innerJoinAndSelect('tcs.section', 'section')
      .innerJoinAndSelect('tcs.teacher', 'teacher')
      .innerJoinAndSelect('teacher.user', 'user')
      .where('section.class_id = :classId', { classId })
      .andWhere('section.tenant_id = :tenantId', { tenantId })
      .andWhere('section.deleted_at IS NULL')
      .andWhere('teacher.tenant_id = :tenantId', { tenantId })
      .andWhere('teacher.deleted_at IS NULL')
      .orderBy('user.full_name', 'ASC')
      .getMany();

    // Fold every section name a teacher teaches onto that teacher's one
    // row — a teacher can hold more than one section, and the tab wants
    // one row per teacher, not one row per (teacher, section) pair.
    const byTeacher = new Map<string, ClassTeacher>();
    for (const row of rows) {
      const existing = byTeacher.get(row.teacher.id);
      if (existing) {
        if (!existing.section_names.includes(row.section.section_name)) {
          existing.section_names.push(row.section.section_name);
        }
      } else {
        byTeacher.set(row.teacher.id, {
          id: row.teacher.id,
          employee_id: row.teacher.employee_id,
          full_name: row.teacher.user.full_name,
          designations: row.teacher.designations,
          section_names: [row.section.section_name],
        });
      }
    }
    return Array.from(byTeacher.values());
  }

  async update(
    classId: string,
    sectionId: string,
    dto: UpdateSectionDto,
    tenantId: string,
  ): Promise<ClassSection> {
    const section = await this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Section with ID "${sectionId}" not found in class "${classId}"`);
    }

    await this.repo.update({ id: sectionId, class_id: classId, tenant_id: tenantId }, dto);
    return this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    }) as Promise<ClassSection>;
  }

  async remove(classId: string, sectionId: string, tenantId: string): Promise<void> {
    const section = await this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Section with ID "${sectionId}" not found in class "${classId}"`);
    }

    // Check for active students in this section
    const activeStudentCount = await this.studentRepo.count({
      where: {
        class_section_id: sectionId,
        deleted_at: IsNull(),
        enrollment_status: 'ACTIVE' as any,
      },
    });
    if (activeStudentCount > 0) {
      throw new ConflictException(
        `Cannot delete section "${sectionId}": ${activeStudentCount} active student(s) are enrolled in it. Reassign or remove them first.`,
      );
    }

    await this.repo.softDelete({ id: sectionId, class_id: classId, tenant_id: tenantId });
  }
}
