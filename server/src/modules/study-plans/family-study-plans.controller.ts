import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolsService } from '../schools/schools.service';
import { localToday } from '../attendance/attendance-policy.util';
import { LessonDelivery } from './entities/lesson-delivery.entity';
import type { StudyPlan } from './entities/study-plan.entity';
import { StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import {
  FamilyDayPeriodDto,
  FamilyLessonsQueryDto,
  FamilyStudyPlansResponseDto,
  FamilySubjectRefDto,
} from './dto/family-study-plans.dto';
import { lessonAt, subjectBlock, type FamilyExamInfo } from './family-study-plans.view';

/** No unbounded scans: `lessons?date=` stays within this many days of today. */
const MAX_DAYS_FROM_TODAY = 31;
const DAY_MS = 86_400_000;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * [66.2/#2013] What a family sees of the study plans: progress per subject and the
 * lesson on each period of a day. `assertLinked` runs before any data is read.
 * Never returns teacher notes or unreported counts (D20); the controller loads,
 * `family-study-plans.view.ts` shapes.
 */
@ApiTags('family-study-plans')
@ApiTenantAuth()
@Controller('students/:studentId')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FamilyStudyPlansController {
  constructor(
    private readonly familyAccess: FamilyAccessService,
    private readonly plans: StudyPlansService,
    private readonly schedules: PlanScheduleService,
    private readonly resolver: ResolveRoutineService,
    private readonly schools: SchoolsService,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(ClassSubject) private readonly classSubjectRepo: Repository<ClassSubject>,
    @InjectRepository(PeriodSlot) private readonly slotRepo: Repository<PeriodSlot>,
    @InjectRepository(LessonDelivery) private readonly deliveryRepo: Repository<LessonDelivery>,
  ) {}

  private async today(tenantId: string): Promise<string> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return localToday(settings.region?.timezone ?? 'UTC');
  }

  /** Tenant-scoped student + section; 404 when either is gone. */
  private async studentSection(studentId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) throw new NotFoundException(`Student "${studentId}" not found`);
    const section = await this.sectionRepo.findOne({
      where: { id: student.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: { class: true },
    });
    if (!section) throw new NotFoundException(`Class section for student "${studentId}" not found`);
    return { student, section };
  }

  /** exam id -> name + date (this subject's schedule date, else any subject's, else null). */
  private async examInfo(
    tenantId: string,
    subjectId: string,
    plan: StudyPlan,
  ): Promise<FamilyExamInfo> {
    const ids = plan.exam_markers.map((m) => m.exam_id);
    const out: FamilyExamInfo = new Map();
    if (!ids.length) return out;
    const rows: {
      id: string;
      name: string;
      subject_date: string | null;
      any_date: string | null;
    }[] = await this.studentRepo.manager.query(
      `SELECT e.id, e.name,
                (SELECT MIN(s.date)::text FROM exam_schedules s
                  WHERE s.exam_id = e.id AND s.tenant_id = $1 AND s.deleted_at IS NULL
                    AND s.subject_id = $3) AS subject_date,
                (SELECT MIN(s.date)::text FROM exam_schedules s
                  WHERE s.exam_id = e.id AND s.tenant_id = $1 AND s.deleted_at IS NULL) AS any_date
           FROM exams e
          WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status <> 'DRAFT' AND e.id = ANY($2::uuid[])`,
      [tenantId, ids, subjectId],
    );
    for (const r of rows) {
      out.set(r.id, { name: r.name, date: r.subject_date ?? r.any_date });
    }
    return out;
  }

  private async teacherNames(tenantId: string, plan: StudyPlan): Promise<string[]> {
    const ids = await this.plans.ownerTeacherIds(
      tenantId,
      plan.section_id,
      plan.subject_id,
      plan.academic_year_id,
      plan.owner_override_teacher_id,
    );
    if (!ids.length) return [];
    const rows: { full_name: string }[] = await this.studentRepo.manager.query(
      `SELECT u.full_name FROM teachers t JOIN users u ON u.id = t.user_id
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND t.id = ANY($2::uuid[])
        ORDER BY u.full_name`,
      [tenantId, ids],
    );
    return rows.map((r) => r.full_name);
  }

  @Get('study-plans')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({
    summary:
      "Per subject of the student's section: last taught lesson, next 5 lessons, behind counts and exam syllabus progress. Never notes or unreported counts.",
  })
  async studyPlans(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<FamilyStudyPlansResponseDto> {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const { section } = await this.studentSection(studentId, tenant.id);
    const today = await this.today(tenant.id);

    const offered = await this.classSubjectRepo.find({
      where: {
        tenant_id: tenant.id,
        class_id: section.class_id,
        academic_year_id: section.class.academic_year_id,
        deleted_at: IsNull(),
      },
      relations: { subject: true },
    });

    const subjects: FamilyStudyPlansResponseDto['subjects'] = [];
    const without: FamilySubjectRefDto[] = [];
    let term: FamilyStudyPlansResponseDto['term'] = null;
    for (const cs of offered) {
      const ref = {
        id: cs.subject_id,
        name_en: cs.subject?.name_en ?? null,
        name_bn: cs.subject?.name_bn ?? null,
      };
      const plan = await this.plans.currentPlanFor(tenant.id, section.id, cs.subject_id, today);
      if (!plan) {
        without.push(ref);
        continue;
      }
      const [schedule, teacherNames, exams] = await Promise.all([
        this.schedules.scheduleFor(plan, tenant.id),
        this.teacherNames(tenant.id, plan),
        this.examInfo(tenant.id, cs.subject_id, plan),
      ]);
      if (!term && plan.academic_term_id) {
        const t: { id: string; name: string }[] = await this.studentRepo.manager.query(
          `SELECT id, name FROM academic_terms WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [plan.academic_term_id, tenant.id],
        );
        term = t[0] ?? null;
      }
      subjects.push(
        subjectBlock({
          planId: plan.id,
          subject: ref,
          teacherNames,
          schedule,
          markers: plan.exam_markers,
          exams,
        }),
      );
    }
    return {
      section: {
        id: section.id,
        name: section.section_name,
        class_name: section.class?.name ?? '',
      },
      term,
      subjects,
      subjects_without_plan: without,
    };
  }

  @Get('lessons')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({
    summary: "Each period of one day with its planned lesson and the teacher's report status.",
  })
  async lessons(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: FamilyLessonsQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<FamilyDayPeriodDto[]> {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const { section } = await this.studentSection(studentId, tenant.id);
    const { date } = query;
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('date must be a real calendar date (YYYY-MM-DD)');
    }
    if (daysApart(date, await this.today(tenant.id)) > MAX_DAYS_FROM_TODAY) {
      throw new BadRequestException(`date must be within ${MAX_DAYS_FROM_TODAY} days of today`);
    }

    // Section id comes from the tenant-scoped student row (same source as /study-plans); the resolver applies PUBLISHED-only for family callers.
    const slots = await this.resolver.resolveRoutine(
      { section_id: section.id, from: date, to: date },
      tenant.id,
      { role: tenant.role, userId: user.sub },
    );
    if (!slots.length) return [];

    const [periodSlots, deliveries] = await Promise.all([
      this.slotRepo.find({ where: { tenant_id: tenant.id } }),
      this.deliveryRepo.find({
        where: {
          tenant_id: tenant.id,
          section_id: section.id,
          date,
          subject_id: In([...new Set(slots.map((s) => s.subject_id))]),
          is_extra: false,
        },
      }),
    ]);
    const slotAt = new Map(periodSlots.map((p) => [p.id, p]));
    const seq = new Map(periodSlots.map((p) => [p.id, p.sequence]));

    const schedules = new Map<
      string,
      Awaited<ReturnType<PlanScheduleService['scheduleFor']>> | null
    >();
    for (const sid of new Set(slots.map((s) => s.subject_id))) {
      const plan = await this.plans.currentPlanFor(tenant.id, section.id, sid, date);
      schedules.set(sid, plan ? await this.schedules.scheduleFor(plan, tenant.id) : null);
    }

    return slots
      .map((s) => {
        const sch = schedules.get(s.subject_id);
        // Prefer the regular (non-extra) report for this slot.
        const row = deliveries
          .filter((d) => d.period_slot_id === s.period_slot_id && d.subject_id === s.subject_id)
          .sort((a, b) => Number(a.is_extra) - Number(b.is_extra))[0];
        return {
          period_slot_id: s.period_slot_id,
          sequence: slotAt.get(s.period_slot_id)?.sequence ?? 0,
          starts_at: (slotAt.get(s.period_slot_id)?.starts_at ?? '').slice(0, 5),
          subject: { id: s.subject_id, name_en: s.subject_name_en, name_bn: s.subject_name_bn },
          cancelled: s.cancelled,
          lesson: sch ? lessonAt(sch, date, s.period_slot_id, seq) : null,
          status: (row?.status as FamilyDayPeriodDto['status']) ?? null,
        };
      })
      .sort((a, b) => a.sequence - b.sequence);
  }
}
