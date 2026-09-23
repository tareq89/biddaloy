import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { CopyRoutineDto } from './dto/workflow.dto';
import { RoutineState } from '@biddaloy/shared';

export interface UnmappedSection {
  source_section_id: string;
  class_name: string;
  section_name: string;
}

export interface UnmappedSubject {
  source_subject_id: string;
  code: string;
}

export interface CopyRoutineResult {
  routine: Routine;
  unmapped_sections: UnmappedSection[];
  unmapped_subjects: UnmappedSubject[];
  skipped_slot_count: number;
}

/**
 * D19: copies every slot from a source routine into a brand-new routine
 * for the target academic year. `section_id` is remapped by matching
 * class name + section name across the two years (`ClassSection`/`Class`
 * carry no cross-year identity of their own — a new year means new row
 * ids); `subject_id` is remapped by matching `Subject.code` only when the
 * source id no longer resolves (Subject is tenant-scoped, not
 * year-scoped, so normally the id itself still works).
 *
 * Anything that can't be mapped is *reported*, never silently dropped —
 * the slot that needed it is skipped and the caller sees exactly why.
 *
 * The copy always lands in `DRAFT`. Teacher assignments
 * (`routine_slot_teachers`) are copied only when that teacher still holds
 * the matching `TeacherClassSection` assignment in the target year;
 * otherwise that teacher's row is left out of the new slot (not dropped
 * silently and not defaulted to someone else).
 */
@Injectable()
export class CopyRoutineService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
  ) {}

  async copyToYear(
    sourceRoutineId: string,
    dto: CopyRoutineDto,
    tenantId: string,
  ): Promise<CopyRoutineResult> {
    const source = await this.routineRepo.findOne({
      where: { id: sourceRoutineId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!source) {
      throw new NotFoundException(`Routine ID "${sourceRoutineId}" not found`);
    }

    const targetYear = await this.yearRepo.findOne({
      where: { id: dto.target_academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!targetYear) {
      throw new NotFoundException(`Academic year ID "${dto.target_academic_year_id}" not found`);
    }

    const existingTarget = await this.routineRepo.findOne({
      where: { tenant_id: tenantId, academic_year_id: targetYear.id, deleted_at: IsNull() },
    });
    if (existingTarget) {
      throw new ConflictException(`A routine already exists for academic year "${targetYear.id}"`);
    }

    const sourceSlots = await this.slotRepo.find({
      where: { routine_id: source.id, tenant_id: tenantId },
    });

    const { sectionMap, unmapped_sections } = await this.buildSectionMap(
      sourceSlots.map((s) => s.section_id),
      targetYear.id,
      tenantId,
    );
    const { subjectMap, unmapped_subjects } = await this.buildSubjectMap(
      sourceSlots.map((s) => s.subject_id),
      tenantId,
    );

    const teacherRows = await this.slotTeacherRepo.find({
      where: { routine_slot_id: In(sourceSlots.map((s) => s.id)), tenant_id: tenantId },
    });
    const teachersBySlot = new Map<string, string[]>();
    for (const row of teacherRows) {
      const list = teachersBySlot.get(row.routine_slot_id) ?? [];
      list.push(row.teacher_id);
      teachersBySlot.set(row.routine_slot_id, list);
    }

    const newRoutine = await this.routineRepo.save(
      this.routineRepo.create({
        tenant_id: tenantId,
        academic_year_id: targetYear.id,
        name: source.name,
        state: RoutineState.DRAFT,
        published_at: null,
      }),
    );

    let skippedSlotCount = 0;
    for (const slot of sourceSlots) {
      const mappedSectionId = sectionMap.get(slot.section_id);
      const mappedSubjectId = subjectMap.get(slot.subject_id);
      if (!mappedSectionId || !mappedSubjectId) {
        skippedSlotCount += 1;
        continue;
      }

      const newSlot = await this.slotRepo.save(
        this.slotRepo.create({
          tenant_id: tenantId,
          routine_id: newRoutine.id,
          section_id: mappedSectionId,
          period_slot_id: slot.period_slot_id,
          weekday: slot.weekday,
          subject_id: mappedSubjectId,
          room_id: slot.room_id,
          recurrence: slot.recurrence,
          recurrence_offset: slot.recurrence_offset,
          valid_from: slot.valid_from,
          valid_to: slot.valid_to,
        }),
      );

      const sourceTeacherIds = teachersBySlot.get(slot.id) ?? [];
      if (sourceTeacherIds.length === 0) continue;

      const stillAssigned = await this.tcsRepo.find({
        where: {
          teacher_id: In(sourceTeacherIds),
          section_id: mappedSectionId,
          tenant_id: tenantId,
        },
      });
      const assignedTeacherIds = new Set(
        stillAssigned
          .filter((r) => r.subject_id === null || r.subject_id === mappedSubjectId)
          .map((r) => r.teacher_id),
      );
      const keptTeacherIds = sourceTeacherIds.filter((id) => assignedTeacherIds.has(id));
      if (keptTeacherIds.length > 0) {
        await this.slotTeacherRepo.save(
          keptTeacherIds.map((teacherId) =>
            this.slotTeacherRepo.create({
              tenant_id: tenantId,
              routine_slot_id: newSlot.id,
              teacher_id: teacherId,
            }),
          ),
        );
      }
    }

    return {
      routine: newRoutine,
      unmapped_sections,
      unmapped_subjects,
      skipped_slot_count: skippedSlotCount,
    };
  }

  private async buildSectionMap(
    sourceSectionIds: string[],
    targetYearId: string,
    tenantId: string,
  ): Promise<{ sectionMap: Map<string, string>; unmapped_sections: UnmappedSection[] }> {
    const sectionMap = new Map<string, string>();
    const unmapped_sections: UnmappedSection[] = [];
    const uniqueIds = Array.from(new Set(sourceSectionIds));
    if (uniqueIds.length === 0) return { sectionMap, unmapped_sections };

    const sourceSections = await this.sectionRepo.find({
      where: { id: In(uniqueIds), tenant_id: tenantId },
    });
    const sourceClasses = await this.classRepo.find({
      where: { id: In(sourceSections.map((s) => s.class_id)), tenant_id: tenantId },
    });
    const classById = new Map(sourceClasses.map((c) => [c.id, c]));

    const targetClasses = await this.classRepo.find({
      where: { tenant_id: tenantId, academic_year_id: targetYearId },
    });
    if (targetClasses.length === 0) {
      for (const section of sourceSections) {
        const cls = classById.get(section.class_id);
        unmapped_sections.push({
          source_section_id: section.id,
          class_name: cls?.name ?? section.class_id,
          section_name: section.section_name,
        });
      }
      return { sectionMap, unmapped_sections };
    }

    const targetSections = await this.sectionRepo.find({
      where: { class_id: In(targetClasses.map((c) => c.id)), tenant_id: tenantId },
    });
    const targetSectionByKey = new Map<string, string>(
      targetSections.map((s) => {
        const targetClass = targetClasses.find((c) => c.id === s.class_id);
        return [`${targetClass?.name}|${s.section_name}`, s.id];
      }),
    );

    for (const section of sourceSections) {
      const cls = classById.get(section.class_id);
      const key = `${cls?.name}|${section.section_name}`;
      const targetSectionId = targetSectionByKey.get(key);
      if (targetSectionId) {
        sectionMap.set(section.id, targetSectionId);
      } else {
        unmapped_sections.push({
          source_section_id: section.id,
          class_name: cls?.name ?? section.class_id,
          section_name: section.section_name,
        });
      }
    }

    return { sectionMap, unmapped_sections };
  }

  private async buildSubjectMap(
    sourceSubjectIds: string[],
    tenantId: string,
  ): Promise<{ subjectMap: Map<string, string>; unmapped_subjects: UnmappedSubject[] }> {
    const subjectMap = new Map<string, string>();
    const unmapped_subjects: UnmappedSubject[] = [];
    const uniqueIds = Array.from(new Set(sourceSubjectIds));
    if (uniqueIds.length === 0) return { subjectMap, unmapped_subjects };

    // Includes soft-deleted rows so a deleted-then-recreated subject's
    // historic code is still available for the fallback match below.
    const subjectsWithDeleted = await this.subjectRepo.find({
      where: { id: In(uniqueIds), tenant_id: tenantId },
      withDeleted: true,
    });
    const subjectById = new Map(subjectsWithDeleted.map((s) => [s.id, s]));
    const activeByCode = new Map(
      subjectsWithDeleted.filter((s) => !s.deleted_at).map((s) => [s.code, s]),
    );

    for (const id of uniqueIds) {
      const subject = subjectById.get(id);
      // Subject is tenant-scoped, not year-scoped — the id itself almost
      // always still resolves. If it doesn't resolve to an active row,
      // fall back to matching the historic code before giving up.
      if (subject && !subject.deleted_at) {
        subjectMap.set(id, subject.id);
        continue;
      }
      const byCode = subject ? activeByCode.get(subject.code) : undefined;
      if (byCode) {
        subjectMap.set(id, byCode.id);
      } else {
        unmapped_subjects.push({ source_subject_id: id, code: subject?.code ?? id });
      }
    }

    return { subjectMap, unmapped_subjects };
  }
}
