import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  AuditAction,
  TeacherAssignmentType,
  UserStatus,
  YEAR_ROLLOVER_BLOCKS,
  type YearRolloverBlock,
} from '@biddaloy/shared';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { ClassSection } from './entities/class-section.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Teacher } from './entities/teacher.entity';
import { TeacherClassSection } from './entities/teacher-class-section.entity';
import { FeeStructureService } from '../fees/fees.service';
import { GradingService } from '../grading/grading.service';
import { AcademicTermsService } from '../calendar/academic-terms.service';
import { AuditService } from '../audit/audit.service';
import { assertYearOpen } from '../../common/utils/year-open.guard';
import type { RequestContext } from '../../common/request-context.util';

export interface YearRolloverInput {
  name: string;
  start_date: string;
  end_date: string;
  include: YearRolloverBlock[];
}

export interface BlockResult {
  created: number;
  existing: number;
  skipped: { name: string; reason: string }[];
}

export interface YearRolloverResult {
  /** `null` in a preview when the target year does not exist yet. */
  target_year_id: string | null;
  classes?: BlockResult;
  sections?: BlockResult;
  class_subjects?: BlockResult;
  teacher_assignments?: BlockResult;
  fee_structures?: BlockResult;
  grading_scales?: BlockResult;
  terms?: BlockResult;
  skipped_staff: { teacher_name: string; section: string; subject: string }[];
}

const empty = (): BlockResult => ({ created: 0, existing: 0, skipped: [] });
const lc = (s: string | null) => (s ?? '').toLowerCase();

/**
 * [69.2.01] Year rollover (D2, D13, D14): copies one year's setup into a target
 * year. `create` runs in one transaction (all-or-nothing); `preview` runs the
 * same plan with `dryRun` and writes nothing. Every block matches by natural
 * key, so a re-run counts rows `existing` and never duplicates them.
 */
@Injectable()
export class YearRolloverService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly feeStructures: FeeStructureService,
    private readonly grading: GradingService,
    private readonly terms: AcademicTermsService,
    private readonly audit: AuditService,
  ) {}

  preview(
    tenantId: string,
    sourceYearId: string,
    input: YearRolloverInput,
  ): Promise<YearRolloverResult> {
    return this.run(this.dataSource.manager, tenantId, null, sourceYearId, input, true);
  }

  create(
    tenantId: string,
    userId: string,
    sourceYearId: string,
    input: YearRolloverInput,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<YearRolloverResult> {
    return this.dataSource.transaction((manager) =>
      this.run(manager, tenantId, userId, sourceYearId, input, false, context),
    );
  }

  private async run(
    manager: EntityManager,
    tenantId: string,
    userId: string | null,
    sourceYearId: string,
    input: YearRolloverInput,
    dryRun: boolean,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<YearRolloverResult> {
    // Two rollovers into the same year name must run one after the other: the copied rows have
    // no DB unique key behind their natural keys (D14), so READ COMMITTED alone would let both
    // runs insert the same classes. A transaction-scoped advisory lock queues the second run;
    // when it wakes it finds the first run's rows and reports them as `existing`.
    if (!dryRun) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `year-rollover:${tenantId}:${input.name}`,
      ]);
    }
    const years = manager.getRepository(AcademicYear);
    const source = await years.findOne({
      where: { id: sourceYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!source) throw new NotFoundException('Academic year not found');

    let target = await years.findOne({
      where: { name: input.name, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (target?.id === source.id) {
      throw new BadRequestException('The new year must be different from the source year');
    }
    if (target) await assertYearOpen(manager, tenantId, target.id);
    else if (!dryRun) {
      target = await years.save(
        years.create({
          name: input.name,
          start_date: input.start_date as unknown as Date,
          end_date: input.end_date as unknown as Date,
          is_current: false,
          tenant_id: tenantId,
        }),
      );
    }
    const targetId = target?.id ?? null;
    // A preview of a not-yet-existing year plans against a throwaway id: no rows can match it.
    const planId = targetId ?? randomUUID();
    const want = new Set(input.include.filter((b) => YEAR_ROLLOVER_BLOCKS.includes(b)));
    const out: YearRolloverResult = { target_year_id: targetId, skipped_staff: [] };

    // Classes -> sections are always matched so later blocks can map ids even when
    // the block itself is not included (it then only maps, never creates).
    const classMap = new Map<string, string>();
    const sectionMap = new Map<string, string>();
    const classes = await this.copyClasses(
      manager,
      tenantId,
      source.id,
      planId,
      targetId,
      dryRun,
      want.has('classes'),
      classMap,
    );
    if (want.has('classes')) out.classes = classes;
    const sections = await this.copySections(
      manager,
      tenantId,
      classMap,
      dryRun,
      want.has('sections'),
      sectionMap,
    );
    if (want.has('sections')) out.sections = sections;
    if (want.has('class_subjects')) {
      out.class_subjects = await this.copyClassSubjects(
        manager,
        tenantId,
        source.id,
        planId,
        classMap,
        dryRun,
      );
    }
    if (want.has('teacher_assignments')) {
      const r = await this.copyTeachers(manager, tenantId, sectionMap, dryRun);
      out.teacher_assignments = r.result;
      out.skipped_staff = r.skippedStaff;
    }
    if (want.has('fee_structures')) {
      out.fee_structures = await this.feeStructures.copyStructuresToYear(
        manager,
        tenantId,
        source.id,
        planId,
        classMap,
        sectionMap,
        dryRun,
      );
    }
    if (want.has('grading_scales')) {
      out.grading_scales = await this.grading.copyScalesToYear(
        manager,
        tenantId,
        source.id,
        planId,
        classMap,
        dryRun,
        userId,
        context,
      );
    }
    if (want.has('terms')) {
      // ponytail: preview of a year that does not exist yet reports no terms plan
      // (terms need the year's dates row); the real run does the work.
      out.terms = target
        ? await this.terms.copyTermsToYear(manager, tenantId, source.id, target.id, dryRun)
        : empty();
    }

    if (!dryRun && target) {
      await this.audit.record(
        {
          action: AuditAction.YEAR_ROLLOVER,
          entity_type: 'AcademicYear',
          entity_id: target.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: {
            source_year_id: source.id,
            counts: Object.fromEntries(
              Object.entries(out)
                .filter(([, v]) => v && typeof v === 'object' && 'created' in v)
                .map(([k, v]) => [
                  k,
                  { created: (v as BlockResult).created, existing: (v as BlockResult).existing },
                ]),
            ),
            skipped_staff: out.skipped_staff.length,
          },
        },
        manager,
      );
    }
    return out;
  }

  private async copyClasses(
    manager: EntityManager,
    tenantId: string,
    sourceId: string,
    planId: string,
    targetId: string | null,
    dryRun: boolean,
    create: boolean,
    classMap: Map<string, string>,
  ): Promise<BlockResult> {
    const key = (c: Class) => JSON.stringify([lc(c.name), c.shift, c.version]);
    const live = (id: string) => ({
      tenant_id: tenantId,
      academic_year_id: id,
      deleted_at: IsNull(),
    });
    const sources = await manager.find(Class, {
      where: live(sourceId),
      order: { created_at: 'ASC', id: 'ASC' },
    });
    const targets = targetId ? await manager.find(Class, { where: live(targetId) }) : [];
    const byKey = new Map(targets.map((t) => [key(t), t.id]));
    const res = empty();
    for (const src of sources) {
      const hit = byKey.get(key(src));
      if (hit) {
        classMap.set(src.id, hit);
        res.existing++;
        continue;
      }
      if (!create) continue;
      res.created++;
      if (dryRun) {
        classMap.set(src.id, randomUUID());
        continue;
      }
      const saved = await manager.save(
        manager.create(Class, {
          name: src.name,
          numeric_grade: src.numeric_grade,
          shift: src.shift,
          version: src.version,
          shift_id: src.shift_id,
          academic_year_id: planId,
          tenant_id: tenantId,
        }),
      );
      byKey.set(key(src), saved.id);
      classMap.set(src.id, saved.id);
    }
    return res;
  }

  private async copySections(
    manager: EntityManager,
    tenantId: string,
    classMap: Map<string, string>,
    dryRun: boolean,
    create: boolean,
    sectionMap: Map<string, string>,
  ): Promise<BlockResult> {
    const res = empty();
    if (classMap.size === 0) return res;
    const srcIds = [...classMap.keys()];
    const sources = await manager
      .getRepository(ClassSection)
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId AND s.class_id IN (:...srcIds) AND s.deleted_at IS NULL', {
        tenantId,
        srcIds,
      })
      .orderBy('s.created_at', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .getMany();
    const targetIds = [...classMap.values()];
    const targets = await manager
      .getRepository(ClassSection)
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId AND s.class_id IN (:...targetIds) AND s.deleted_at IS NULL', {
        tenantId,
        targetIds,
      })
      .getMany();
    const key = (classId: string, name: string) => JSON.stringify([classId, name.toLowerCase()]);
    const byKey = new Map(targets.map((t) => [key(t.class_id, t.section_name), t.id]));
    for (const src of sources) {
      const targetClass = classMap.get(src.class_id)!;
      const hit = byKey.get(key(targetClass, src.section_name));
      if (hit) {
        sectionMap.set(src.id, hit);
        res.existing++;
        continue;
      }
      if (!create) continue;
      res.created++;
      if (dryRun) {
        sectionMap.set(src.id, randomUUID());
        continue;
      }
      const saved = await manager.save(
        manager.create(ClassSection, {
          class_id: targetClass,
          section_name: src.section_name,
          capacity: src.capacity,
          group_name: src.group_name,
          tenant_id: tenantId,
        }),
      );
      sectionMap.set(src.id, saved.id);
    }
    return res;
  }

  private async copyClassSubjects(
    manager: EntityManager,
    tenantId: string,
    sourceYearId: string,
    targetYearId: string,
    classMap: Map<string, string>,
    dryRun: boolean,
  ): Promise<BlockResult> {
    const res = empty();
    const sources = await manager.find(ClassSubject, {
      where: { tenant_id: tenantId, academic_year_id: sourceYearId, deleted_at: IsNull() },
      relations: { subject: true },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    const targets = await manager.find(ClassSubject, {
      where: { tenant_id: tenantId, academic_year_id: targetYearId, deleted_at: IsNull() },
    });
    const taken = new Set(targets.map((t) => `${t.class_id}|${t.subject_id}`));
    const toInsert: ClassSubject[] = [];
    for (const src of sources) {
      const classId = classMap.get(src.class_id);
      if (!classId) {
        res.skipped.push({
          name: src.subject?.name_en ?? src.subject_id,
          reason: 'CLASS_NOT_COPIED',
        });
        continue;
      }
      const k = `${classId}|${src.subject_id}`;
      if (taken.has(k)) {
        res.existing++;
        continue;
      }
      taken.add(k);
      res.created++;
      toInsert.push(
        manager.create(ClassSubject, {
          tenant_id: tenantId,
          class_id: classId,
          subject_id: src.subject_id,
          academic_year_id: targetYearId,
          is_graded_only: src.is_graded_only,
          is_optional: src.is_optional,
          group_name: src.group_name,
          choice_group: src.choice_group,
        }),
      );
    }
    if (!dryRun && toInsert.length) await manager.insert(ClassSubject, toInsert);
    return res;
  }

  private async copyTeachers(
    manager: EntityManager,
    tenantId: string,
    sectionMap: Map<string, string>,
    dryRun: boolean,
  ): Promise<{ result: BlockResult; skippedStaff: YearRolloverResult['skipped_staff'] }> {
    const result = empty();
    const skippedStaff: YearRolloverResult['skipped_staff'] = [];
    if (sectionMap.size === 0) return { result, skippedStaff };
    const srcIds = [...sectionMap.keys()];
    const rows = await manager
      .getRepository(TeacherClassSection)
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.section', 'section')
      .leftJoinAndSelect('t.subject', 'subject')
      .where('t.tenant_id = :tenantId AND t.section_id IN (:...srcIds)', { tenantId, srcIds })
      .orderBy('t.created_at', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();
    const teacherIds = [...new Set(rows.map((r) => r.teacher_id))];
    const teachers = teacherIds.length
      ? await manager
          .getRepository(Teacher)
          .createQueryBuilder('te')
          .withDeleted()
          .innerJoinAndSelect('te.user', 'u')
          .where('te.id IN (:...teacherIds) AND te.tenant_id = :tenantId', { teacherIds, tenantId })
          .getMany()
      : [];
    const teacherById = new Map(teachers.map((t) => [t.id, t]));
    // A user removed from the school has no user_tenants row.
    const memberRows: { user_id: string }[] = teachers.length
      ? await manager.query(
          `SELECT user_id FROM user_tenants WHERE tenant_id = $1 AND user_id = ANY($2) AND deleted_at IS NULL`,
          [tenantId, teachers.map((t) => t.user_id)],
        )
      : [];
    const members = new Set(memberRows.map((m) => m.user_id));

    const targetSections = [...sectionMap.values()];
    const existing = await manager
      .getRepository(TeacherClassSection)
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId AND t.section_id IN (:...targetSections)', {
        tenantId,
        targetSections,
      })
      .getMany();
    const k = (t: string, s: string, sub: string | null, a: string) =>
      `${t}|${s}|${sub ?? ''}|${a}`;
    const taken = new Set(
      existing.map((e) => k(e.teacher_id, e.section_id, e.subject_id, e.assignment_type)),
    );
    // One CLASS_TEACHER per section (UQ_tcs_section_class_teacher): a different teacher already
    // there counts the source row as `existing` instead of aborting the transaction.
    const classTeacherSections = new Set(
      existing
        .filter((e) => e.assignment_type === TeacherAssignmentType.CLASS_TEACHER)
        .map((e) => e.section_id),
    );
    const toInsert: TeacherClassSection[] = [];
    for (const row of rows) {
      const teacher = teacherById.get(row.teacher_id);
      const gone =
        !teacher ||
        teacher.deleted_at !== null ||
        teacher.user.status !== UserStatus.ACTIVE ||
        !members.has(teacher.user_id);
      if (gone) {
        skippedStaff.push({
          teacher_name: teacher?.user?.full_name ?? '',
          section: row.section.section_name,
          subject: row.subject?.name_en ?? '',
        });
        continue;
      }
      const sectionId = sectionMap.get(row.section_id)!;
      const key = k(row.teacher_id, sectionId, row.subject_id, row.assignment_type);
      const isClassTeacher = row.assignment_type === TeacherAssignmentType.CLASS_TEACHER;
      if (taken.has(key) || (isClassTeacher && classTeacherSections.has(sectionId))) {
        result.existing++;
        continue;
      }
      taken.add(key);
      if (isClassTeacher) classTeacherSections.add(sectionId);
      result.created++;
      toInsert.push(
        manager.create(TeacherClassSection, {
          teacher_id: row.teacher_id,
          section_id: sectionId,
          subject_id: row.subject_id,
          assignment_type: row.assignment_type,
          tenant_id: tenantId,
        }),
      );
    }
    if (!dryRun && toInsert.length) await manager.insert(TeacherClassSection, toInsert);
    return { result, skippedStaff };
  }
}
