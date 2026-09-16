import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction, EnrollmentStatus, PeriodType } from '@biddaloy/shared';
import { RecurringSchedule, RecurringScheduleRule } from './entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from './entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from './entities/recurring-schedule-exclusion.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { AuditService } from '../audit/audit.service';
import {
  AddExclusionDto,
  CloneScheduleDto,
  CloneScheduleResultDto,
  CreateRecurringScheduleDto,
  QueryRecurringSchedulesDto,
  RecurringScheduleResponseDto,
  SchedulePreviewDto,
  StudentScheduleItemDto,
  UpdateRecurringScheduleDto,
} from './dto/recurring-schedules.dto';

const PREVIEW_LIMIT = 50;

/**
 * [16.7.1] CRUD + exclusions + clone-to-next-year for `RecurringSchedule`.
 * Actually generating fees on a schedule's due date is 16.7.2's job (it
 * reads `is_active` schedules via `recurrence.util.isDue` and calls
 * `FeeGenerationsService.create`); this service only stores the
 * definition and resolves who it currently targets.
 */
@Injectable()
export class RecurringSchedulesService {
  constructor(
    @InjectRepository(RecurringSchedule)
    private readonly repo: Repository<RecurringSchedule>,
    @InjectRepository(RecurringScheduleStructure)
    private readonly structureRepo: Repository<RecurringScheduleStructure>,
    @InjectRepository(RecurringScheduleExclusion)
    private readonly exclusionRepo: Repository<RecurringScheduleExclusion>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly classSectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly auditService: AuditService,
  ) {}

  private validateRule(rule: RecurringScheduleRule): void {
    if (rule.kind === 'MONTHLY') {
      const dom = rule.day_of_month;
      const isValidDay = dom === 'LAST' || (Number.isInteger(dom) && dom >= 1 && dom <= 28);
      if (!isValidDay) {
        throw new BadRequestException(
          "rule.day_of_month must be 1-28 or 'LAST' for a MONTHLY rule",
        );
      }
    } else if (rule.kind === 'WEEKLY') {
      const weekdays = rule.weekdays;
      const isValid =
        Array.isArray(weekdays) &&
        weekdays.length > 0 &&
        weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
      if (!isValid) {
        throw new BadRequestException(
          'rule.weekdays must be a non-empty array of 1-7 for a WEEKLY rule',
        );
      }
    } else {
      throw new BadRequestException("rule.kind must be 'MONTHLY' or 'WEEKLY'");
    }
  }

  private periodTypeFor(rule: RecurringScheduleRule): PeriodType {
    return rule.kind === 'MONTHLY' ? PeriodType.MONTH : PeriodType.WEEK;
  }

  private async loadAcademicYear(id: string, tenantId: string): Promise<AcademicYear> {
    const year = await this.academicYearRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!year) {
      throw new NotFoundException(`Academic year "${id}" not found`);
    }
    return year;
  }

  private async validateAudience(
    audience: { class_id?: string; section_id?: string },
    academicYearId: string,
    tenantId: string,
  ): Promise<void> {
    let classId = audience.class_id;
    if (classId) {
      const klass = await this.classRepo.findOne({
        where: { id: classId, tenant_id: tenantId, academic_year_id: academicYearId },
      });
      if (!klass) {
        throw new BadRequestException(
          `Class "${classId}" does not belong to this tenant/academic year`,
        );
      }
    }
    if (audience.section_id) {
      const section = await this.classSectionRepo.findOne({
        where: { id: audience.section_id, tenant_id: tenantId },
      });
      if (!section) {
        throw new BadRequestException(`Section "${audience.section_id}" not found`);
      }
      if (classId && section.class_id !== classId) {
        throw new BadRequestException('audience.section_id does not belong to audience.class_id');
      }
    }
  }

  private async validateFeeStructureIds(
    ids: string[],
    academicYearId: string,
    tenantId: string,
  ): Promise<void> {
    if (ids.length === 0) {
      throw new BadRequestException('fee_structure_ids must not be empty');
    }
    const found = await this.feeStructureRepo.find({
      where: { id: In(ids), tenant_id: tenantId, academic_year_id: academicYearId },
    });
    if (found.length !== new Set(ids).size) {
      throw new BadRequestException(
        'One or more fee_structure_ids do not belong to this tenant/academic year',
      );
    }
  }

  private resolveEndsOn(requested: string | undefined, academicYear: AcademicYear): string {
    const capDate = String(academicYear.end_date);
    if (!requested) {
      return capDate;
    }
    if (requested > capDate) {
      throw new BadRequestException(
        `ends_on (${requested}) may not be after the academic year's end date (${capDate})`,
      );
    }
    return requested;
  }

  async create(
    dto: CreateRecurringScheduleDto,
    tenantId: string,
    userId: string,
  ): Promise<RecurringScheduleResponseDto> {
    const academicYear = await this.loadAcademicYear(dto.academic_year_id, tenantId);
    this.validateRule(dto.rule as RecurringScheduleRule);
    await this.validateAudience(dto.audience, dto.academic_year_id, tenantId);
    await this.validateFeeStructureIds(dto.fee_structure_ids, dto.academic_year_id, tenantId);
    const endsOn = this.resolveEndsOn(dto.ends_on, academicYear);

    const saved = await this.repo.manager.transaction(async (manager) => {
      const scheduleRepo = manager.getRepository(RecurringSchedule);
      const structureRepo = manager.getRepository(RecurringScheduleStructure);

      const schedule = await scheduleRepo.save(
        scheduleRepo.create({
          tenant_id: tenantId,
          academic_year_id: dto.academic_year_id,
          name: dto.name,
          audience: dto.audience,
          rule: dto.rule as RecurringScheduleRule,
          period_type: this.periodTypeFor(dto.rule as RecurringScheduleRule),
          due_days_after_period_start: dto.due_days_after_period_start ?? 9,
          starts_on: dto.starts_on,
          ends_on: endsOn,
          notify_families: dto.notify_families ?? true,
          is_active: dto.is_active ?? true,
          created_by_user_id: userId,
        }),
      );

      await structureRepo.save(
        dto.fee_structure_ids.map((fee_structure_id) =>
          structureRepo.create({ schedule_id: schedule.id, fee_structure_id }),
        ),
      );

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'RecurringSchedule',
          entity_id: schedule.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { name: schedule.name, academic_year_id: schedule.academic_year_id },
        },
        manager,
      );

      return schedule;
    });

    return this.findOne(saved.id, tenantId);
  }

  async findAll(
    query: QueryRecurringSchedulesDto,
    tenantId: string,
  ): Promise<RecurringScheduleResponseDto[]> {
    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (query.academic_year_id) {
      where.academic_year_id = query.academic_year_id;
    }
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }
    const schedules = await this.repo.find({ where, order: { created_at: 'DESC' } });
    return Promise.all(schedules.map((s) => this.toResponseDto(s)));
  }

  async findOne(id: string, tenantId: string): Promise<RecurringScheduleResponseDto> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    return this.toResponseDto(schedule);
  }

  private async getOwnedSchedule(id: string, tenantId: string): Promise<RecurringSchedule> {
    const schedule = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!schedule) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    return schedule;
  }

  private async toResponseDto(schedule: RecurringSchedule): Promise<RecurringScheduleResponseDto> {
    const structures = await this.structureRepo.find({ where: { schedule_id: schedule.id } });
    return {
      id: schedule.id,
      academic_year_id: schedule.academic_year_id,
      name: schedule.name,
      audience: schedule.audience,
      rule: schedule.rule,
      period_type: schedule.period_type,
      due_days_after_period_start: schedule.due_days_after_period_start,
      starts_on: String(schedule.starts_on),
      ends_on: String(schedule.ends_on),
      notify_families: schedule.notify_families,
      is_active: schedule.is_active,
      last_run_period: schedule.last_run_period ? String(schedule.last_run_period) : null,
      fee_structure_ids: structures.map((s) => s.fee_structure_id),
      created_at: schedule.created_at,
    };
  }

  async update(
    id: string,
    dto: UpdateRecurringScheduleDto,
    tenantId: string,
    userId: string,
  ): Promise<RecurringScheduleResponseDto> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    const academicYear = await this.loadAcademicYear(schedule.academic_year_id, tenantId);

    if (dto.audience) {
      await this.validateAudience(dto.audience, schedule.academic_year_id, tenantId);
    }
    const rule = dto.rule ? (dto.rule as RecurringScheduleRule) : undefined;
    if (rule) {
      this.validateRule(rule);
    }
    if (dto.fee_structure_ids) {
      await this.validateFeeStructureIds(
        dto.fee_structure_ids,
        schedule.academic_year_id,
        tenantId,
      );
    }
    const endsOn =
      dto.ends_on !== undefined ? this.resolveEndsOn(dto.ends_on, academicYear) : undefined;

    await this.repo.manager.transaction(async (manager) => {
      const scheduleRepo = manager.getRepository(RecurringSchedule);
      const structureRepo = manager.getRepository(RecurringScheduleStructure);

      await scheduleRepo.update(
        { id: schedule.id },
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
          ...(rule !== undefined ? { rule, period_type: this.periodTypeFor(rule) } : {}),
          ...(dto.due_days_after_period_start !== undefined
            ? { due_days_after_period_start: dto.due_days_after_period_start }
            : {}),
          ...(dto.starts_on !== undefined ? { starts_on: dto.starts_on } : {}),
          ...(endsOn !== undefined ? { ends_on: endsOn } : {}),
          ...(dto.notify_families !== undefined ? { notify_families: dto.notify_families } : {}),
          ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        },
      );

      if (dto.fee_structure_ids) {
        await structureRepo.delete({ schedule_id: schedule.id });
        await structureRepo.save(
          dto.fee_structure_ids.map((fee_structure_id) =>
            structureRepo.create({ schedule_id: schedule.id, fee_structure_id }),
          ),
        );
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'RecurringSchedule',
          entity_id: schedule.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: dto as unknown as Record<string, unknown>,
        },
        manager,
      );
    });

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string, userId: string): Promise<void> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    await this.repo.manager.transaction(async (manager) => {
      await manager.getRepository(RecurringSchedule).softDelete({ id: schedule.id });
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'RecurringSchedule',
          entity_id: schedule.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
        },
        manager,
      );
    });
  }

  async addExclusion(
    id: string,
    dto: AddExclusionDto,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, tenant_id: tenantId },
    });
    if (!student) {
      throw new BadRequestException(`Student "${dto.student_id}" not found`);
    }

    await this.repo.manager.transaction(async (manager) => {
      const exclusionRepo = manager.getRepository(RecurringScheduleExclusion);
      const existing = await exclusionRepo.findOne({
        where: { schedule_id: schedule.id, student_id: dto.student_id },
      });
      if (existing) {
        await exclusionRepo.update(existing.id, {
          reason: dto.reason,
          created_by_user_id: userId,
        });
      } else {
        await exclusionRepo.save(
          exclusionRepo.create({
            schedule_id: schedule.id,
            student_id: dto.student_id,
            reason: dto.reason,
            created_by_user_id: userId,
          }),
        );
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'RecurringSchedule',
          entity_id: schedule.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { excluded_student_id: dto.student_id, reason: dto.reason },
        },
        manager,
      );
    });
  }

  async removeExclusion(
    id: string,
    studentId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    await this.repo.manager.transaction(async (manager) => {
      await manager
        .getRepository(RecurringScheduleExclusion)
        .delete({ schedule_id: schedule.id, student_id: studentId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'RecurringSchedule',
          entity_id: schedule.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { unexcluded_student_id: studentId },
        },
        manager,
      );
    });
  }

  /** Students `schedule.audience` currently matches — class/section
   * (unset = every class/section) and enrollment status. */
  private audienceQuery(schedule: Pick<RecurringSchedule, 'audience' | 'tenant_id'>) {
    const qb = this.studentRepo
      .createQueryBuilder('s')
      .leftJoin('s.class_section', 'cs')
      .where('s.tenant_id = :tenantId', { tenantId: schedule.tenant_id })
      .andWhere('s.deleted_at IS NULL')
      .andWhere('s.enrollment_status = :status', {
        status: schedule.audience.enrollment_status ?? EnrollmentStatus.ACTIVE,
      });
    if (schedule.audience.class_id) {
      qb.andWhere('cs.class_id = :classId', { classId: schedule.audience.class_id });
    }
    if (schedule.audience.section_id) {
      qb.andWhere('s.class_section_id = :sectionId', {
        sectionId: schedule.audience.section_id,
      });
    }
    return qb;
  }

  async preview(id: string, tenantId: string): Promise<SchedulePreviewDto> {
    const schedule = await this.getOwnedSchedule(id, tenantId);
    const excludedIds = new Set(
      (await this.exclusionRepo.find({ where: { schedule_id: schedule.id } })).map(
        (e) => e.student_id,
      ),
    );

    const matched = await this.audienceQuery(schedule)
      .select(['s.id', 's.full_name', 's.registration_number'])
      .orderBy('s.full_name', 'ASC')
      .getMany();

    const billed = matched.filter((s) => !excludedIds.has(s.id));

    return {
      total_count: billed.length,
      students: billed.slice(0, PREVIEW_LIMIT).map((s) => ({
        id: s.id,
        full_name: s.full_name,
        registration_number: s.registration_number ?? null,
        excluded: false,
      })),
    };
  }

  async clone(
    id: string,
    dto: CloneScheduleDto,
    tenantId: string,
    userId: string,
  ): Promise<CloneScheduleResultDto> {
    const source = await this.getOwnedSchedule(id, tenantId);
    const targetYear = await this.loadAcademicYear(dto.academic_year_id, tenantId);

    const sourceStructures = await this.structureRepo.find({
      where: { schedule_id: source.id },
      relations: { fee_structure: true },
    });
    const sourceExclusions = await this.exclusionRepo.find({ where: { schedule_id: source.id } });

    const matchedIds: string[] = [];
    const unmatchedNames: string[] = [];
    for (const s of sourceStructures) {
      const target = await this.feeStructureRepo.findOne({
        where: {
          tenant_id: tenantId,
          academic_year_id: targetYear.id,
          name: s.fee_structure.name,
          fee_type: s.fee_structure.fee_type,
        },
      });
      if (target) {
        matchedIds.push(target.id);
      } else {
        unmatchedNames.push(s.fee_structure.name);
      }
    }

    const created = await this.repo.manager.transaction(async (manager) => {
      const scheduleRepo = manager.getRepository(RecurringSchedule);
      const structureRepo = manager.getRepository(RecurringScheduleStructure);
      const exclusionRepo = manager.getRepository(RecurringScheduleExclusion);

      const clone = await scheduleRepo.save(
        scheduleRepo.create({
          tenant_id: tenantId,
          academic_year_id: targetYear.id,
          name: source.name,
          audience: source.audience,
          rule: source.rule,
          period_type: source.period_type,
          due_days_after_period_start: source.due_days_after_period_start,
          starts_on: String(targetYear.start_date),
          ends_on: String(targetYear.end_date),
          notify_families: source.notify_families,
          is_active: source.is_active,
          created_by_user_id: userId,
        }),
      );

      if (matchedIds.length > 0) {
        await structureRepo.save(
          matchedIds.map((fee_structure_id) =>
            structureRepo.create({ schedule_id: clone.id, fee_structure_id }),
          ),
        );
      }

      if (sourceExclusions.length > 0) {
        await exclusionRepo.save(
          sourceExclusions.map((e) =>
            exclusionRepo.create({
              schedule_id: clone.id,
              student_id: e.student_id,
              reason: e.reason,
              created_by_user_id: userId,
            }),
          ),
        );
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'RecurringSchedule',
          entity_id: clone.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { cloned_from_schedule_id: source.id, academic_year_id: targetYear.id },
        },
        manager,
      );

      return clone;
    });

    return {
      schedule: await this.findOne(created.id, tenantId),
      unmatched_structure_names: unmatchedNames,
    };
  }

  async findForStudent(studentId: string, tenantId: string): Promise<StudentScheduleItemDto[]> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
      relations: { class_section: true },
    });
    if (!student) {
      throw new NotFoundException(`Student "${studentId}" not found`);
    }

    const schedules = await this.repo.find({ where: { tenant_id: tenantId, is_active: true } });
    const exclusions = await this.exclusionRepo.find({ where: { student_id: studentId } });
    const excludedScheduleIds = new Set(exclusions.map((e) => e.schedule_id));

    const results: StudentScheduleItemDto[] = [];
    for (const schedule of schedules) {
      const excluded = excludedScheduleIds.has(schedule.id);
      const matchesAudience =
        student.enrollment_status === (schedule.audience.enrollment_status ?? 'ACTIVE') &&
        (!schedule.audience.class_id ||
          schedule.audience.class_id === student.class_section?.class_id) &&
        (!schedule.audience.section_id ||
          schedule.audience.section_id === student.class_section_id);

      if (matchesAudience || excluded) {
        results.push({
          id: schedule.id,
          name: schedule.name,
          period_type: schedule.period_type,
          due_days_after_period_start: schedule.due_days_after_period_start,
          is_active: schedule.is_active,
          excluded,
        });
      }
    }
    return results;
  }
}
