import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, QueryFailedError, Not } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CreateExamScheduleDto, UpdateExamScheduleDto } from './dto/exam-schedules.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION;
}

export interface ScheduleWriteResult {
  schedule: ExamSchedule;
  /** Non-blocking warnings — currently only "this subject's time overlaps
   * another subject's time in the same exam" (issue rule #4: a school
   * running parallel papers in different halls is legitimate, so this
   * warns rather than blocks). */
  warnings: string[];
}

/**
 * [19.11.1] CRUD for `ExamSchedule`, guarded by `EXAM_MANAGE`. Also holds
 * the family-facing read (`listForFamily`) that implements the visibility
 * rule: staff see a schedule row as soon as it exists (`listForStaff`);
 * families only see the exam's whole schedule once every subject that has
 * at least one `ExamComponent` also has a schedule row.
 */
@Injectable()
export class ExamSchedulesService {
  constructor(
    @InjectRepository(ExamSchedule)
    private readonly repo: Repository<ExamSchedule>,
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamComponent)
    private readonly componentRepo: Repository<ExamComponent>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(AcademicYear)
    private readonly yearRepo: Repository<AcademicYear>,
    private readonly auditService: AuditService,
  ) {}

  private async findExamOrThrow(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException(`Exam "${examId}" not found`);
    }
    return exam;
  }

  /** IDOR guard: the subject must belong to this tenant. */
  private async assertSubjectBelongsToTenant(subjectId: string, tenantId: string): Promise<void> {
    const subject = await this.subjectRepo.findOne({
      where: { id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!subject) {
      throw new BadRequestException(`Subject "${subjectId}" not found for this tenant.`);
    }
  }

  /** `date` must fall within `[year.start_date, year.end_date]` — the same
   * academic-year-range check `AcademicTermsService.assertInsideYear`
   * uses for terms. */
  private async assertDateInsideAcademicYear(exam: Exam, date: string): Promise<void> {
    const year = await this.yearRepo.findOne({ where: { id: exam.academic_year_id } });
    if (!year) {
      throw new NotFoundException(`Academic year "${exam.academic_year_id}" not found`);
    }
    const yearStart = toIsoDate(year.start_date);
    const yearEnd = toIsoDate(year.end_date);
    if (date < yearStart || date > yearEnd) {
      throw new UnprocessableEntityException({
        message: `Schedule date must fall within the exam's academic year (${yearStart} – ${yearEnd})`,
        details: { code: 'SCHEDULE_OUTSIDE_ACADEMIC_YEAR', yearStart, yearEnd },
      });
    }
  }

  private assertTimeOrder(startsAt: string, endsAt: string): void {
    if (startsAt >= endsAt) {
      throw new UnprocessableEntityException({
        message: 'starts_at must be before ends_at',
        details: { code: 'SCHEDULE_INVALID_TIME_RANGE' },
      });
    }
  }

  /** Two half-open time ranges [a,b) and [c,d) overlap iff a < d && c < b. */
  private timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  /** Warns (does not block) when the given date/time range overlaps
   * another subject's schedule row in the same exam. */
  private async findOverlapWarnings(
    examId: string,
    date: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ): Promise<string[]> {
    const siblings = await this.repo.find({
      where: {
        exam_id: examId,
        date,
        deleted_at: IsNull(),
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
      relations: ['subject'],
    });
    const warnings: string[] = [];
    for (const sibling of siblings) {
      if (this.timesOverlap(startsAt, endsAt, sibling.starts_at, sibling.ends_at)) {
        warnings.push(
          `Overlaps "${sibling.subject?.name_en ?? sibling.subject_id}" (${sibling.starts_at}–${sibling.ends_at}) on the same date.`,
        );
      }
    }
    return warnings;
  }

  async create(
    examId: string,
    dto: CreateExamScheduleDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ScheduleWriteResult> {
    const exam = await this.findExamOrThrow(examId, tenantId);
    await this.assertSubjectBelongsToTenant(dto.subject_id, tenantId);
    this.assertTimeOrder(dto.starts_at, dto.ends_at);
    await this.assertDateInsideAcademicYear(exam, dto.date);

    const warnings = await this.findOverlapWarnings(examId, dto.date, dto.starts_at, dto.ends_at);

    try {
      const schedule = await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ExamSchedule);
        const entity = repo.create({
          exam_id: examId,
          subject_id: dto.subject_id,
          date: dto.date,
          starts_at: dto.starts_at,
          ends_at: dto.ends_at,
          venue: dto.venue ?? null,
          tenant_id: tenantId,
        });
        const saved = await repo.save(entity);

        await this.auditService.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'ExamSchedule',
            entity_id: saved.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: null,
            new_values: {
              exam_id: saved.exam_id,
              subject_id: saved.subject_id,
              date: saved.date,
              starts_at: saved.starts_at,
              ends_at: saved.ends_at,
              venue: saved.venue,
            },
          },
          manager,
        );

        return saved;
      });
      return { schedule, warnings };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`This subject is already scheduled for this exam.`);
      }
      throw err;
    }
  }

  async update(
    examId: string,
    id: string,
    dto: UpdateExamScheduleDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ScheduleWriteResult> {
    const exam = await this.findExamOrThrow(examId, tenantId);
    const existing = await this.findOneOrThrow(examId, id, tenantId);

    const startsAt = dto.starts_at ?? existing.starts_at;
    const endsAt = dto.ends_at ?? existing.ends_at;
    const date = dto.date ?? existing.date;
    this.assertTimeOrder(startsAt, endsAt);
    if (dto.date) {
      await this.assertDateInsideAcademicYear(exam, dto.date);
    }

    const warnings = await this.findOverlapWarnings(examId, date, startsAt, endsAt, id);

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      try {
        await this.repo.manager.transaction(async (manager) => {
          const repo = manager.getRepository(ExamSchedule);
          const oldValues = Object.fromEntries(
            changedKeys.map((key) => [key, (existing as any)[key]]),
          );
          await repo.update({ id, tenant_id: tenantId }, dto);

          await this.auditService.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'ExamSchedule',
              entity_id: id,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              ip_address: context.ip,
              user_agent: context.userAgent,
              old_values: oldValues,
              new_values: { ...dto },
            },
            manager,
          );
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(`This subject is already scheduled for this exam.`);
        }
        throw err;
      }
    }

    const schedule = await this.findOneOrThrow(examId, id, tenantId);
    return { schedule, warnings };
  }

  async remove(
    examId: string,
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    await this.findExamOrThrow(examId, tenantId);
    const existing = await this.findOneOrThrow(examId, id, tenantId);

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ExamSchedule);
      await repo.softDelete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'ExamSchedule',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { subject_id: existing.subject_id, date: existing.date },
          new_values: null,
        },
        manager,
      );
    });
  }

  private async findOneOrThrow(
    examId: string,
    id: string,
    tenantId: string,
  ): Promise<ExamSchedule> {
    const entity = await this.repo.findOne({
      where: { id, exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException(`Exam schedule "${id}" not found`);
    }
    return entity;
  }

  /** Staff view: every schedule row for this exam, sorted date then start
   * time, as soon as it exists — an incomplete schedule is still shown. */
  async listForStaff(examId: string, tenantId: string): Promise<ExamSchedule[]> {
    await this.findExamOrThrow(examId, tenantId);
    return this.repo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['subject'],
      order: { date: 'ASC', starts_at: 'ASC' },
    });
  }

  /** Whether every subject that has at least one ExamComponent for this
   * exam also has an ExamSchedule row — the family-visibility gate. */
  private async isScheduleComplete(examId: string, tenantId: string): Promise<boolean> {
    const componentSubjects = await this.componentRepo
      .createQueryBuilder('c')
      .select('DISTINCT c.subject_id', 'subject_id')
      .where('c.exam_id = :examId', { examId })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.deleted_at IS NULL')
      .getRawMany<{ subject_id: string }>();

    if (componentSubjects.length === 0) {
      // No components yet at all — nothing for families to see either way.
      return false;
    }

    const scheduledSubjects = await this.repo
      .createQueryBuilder('s')
      .select('DISTINCT s.subject_id', 'subject_id')
      .where('s.exam_id = :examId', { examId })
      .andWhere('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.deleted_at IS NULL')
      .getRawMany<{ subject_id: string }>();
    const scheduledIds = new Set(scheduledSubjects.map((r) => r.subject_id));

    return componentSubjects.every((row) => scheduledIds.has(row.subject_id));
  }

  /** Family view for one exam: empty unless every subject with a component
   * also has a schedule row (see `isScheduleComplete`). Visibility is
   * decided here, not in the client, per issue rule #5. */
  async listForFamily(examId: string, tenantId: string): Promise<ExamSchedule[]> {
    await this.findExamOrThrow(examId, tenantId);
    const complete = await this.isScheduleComplete(examId, tenantId);
    if (!complete) return [];
    return this.repo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['subject'],
      order: { date: 'ASC', starts_at: 'ASC' },
    });
  }

  /** A student's exam timetable across every exam for their class,
   * upcoming-first. Same family visibility rule per exam as
   * `listForFamily`, applied exam-by-exam. */
  async listForStudentClass(
    classId: string,
    tenantId: string,
    requireComplete = true,
  ): Promise<Array<ExamSchedule & { exam: Exam }>> {
    const exams = await this.examRepo.find({
      where: { class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });

    const rows: Array<ExamSchedule & { exam: Exam }> = [];
    for (const exam of exams) {
      if (requireComplete) {
        const complete = await this.isScheduleComplete(exam.id, tenantId);
        if (!complete) continue;
      }
      const schedules = await this.repo.find({
        where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() },
        relations: ['subject'],
      });
      for (const schedule of schedules) {
        rows.push(Object.assign(schedule, { exam }));
      }
    }

    // Upcoming-first: by date then start time.
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0;
    });
    return rows;
  }
}

/** `AcademicYear.start_date`/`end_date` are typed `Date` on the entity but
 * a Postgres `date` column deserializes as a `YYYY-MM-DD` string at
 * runtime — same helper as `academic-terms.service.ts`'s `toIso`. */
function toIsoDate(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}
