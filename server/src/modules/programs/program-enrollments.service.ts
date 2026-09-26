import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, ProgramEnrollmentStatus } from '@biddaloy/shared';
import { Program } from './entities/program.entity';
import { ProgramMilestone } from './entities/program-milestone.entity';
import { ProgramEnrollment } from './entities/program-enrollment.entity';
import { MilestoneAchievement } from './entities/milestone-achievement.entity';
import { Student } from '../students/entities/student.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  EnrolStudentsDto,
  RecordAchievementsDto,
  UpdateProgramEnrollmentDto,
} from './dto/program-enrollments.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505';
}

/**
 * [34.2.1] Enrolment + achievement recording, the write-paths that ride on
 * `Program`/`ProgramMilestone`. Same scoping/audit style as
 * `programs.service.ts`. Two write paths lean on the migration's DB
 * constraints instead of an unlocked check-then-write:
 * - `enrol` bulk-inserts with `ON CONFLICT ... DO NOTHING` against the
 *   partial unique index on `(program_id, student_id) WHERE status='ACTIVE'`
 *   — a concurrent duplicate enrol just becomes a skip, atomically.
 * - `updateStatus`'s re-activate path catches the same index's 23505 and
 *   maps it to a 409 (`seat-plans.service.ts`'s `assignSeat` is the
 *   precedent for this catch shape).
 * - `record` upserts on `(enrollment_id, milestone_id)` via one
 *   `INSERT ... ON CONFLICT DO UPDATE`, not a loop (acceptance criterion:
 *   500 enrolments = one statement).
 */
@Injectable()
export class ProgramEnrollmentsService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
    @InjectRepository(ProgramMilestone)
    private readonly milestoneRepo: Repository<ProgramMilestone>,
    @InjectRepository(ProgramEnrollment)
    private readonly enrollmentRepo: Repository<ProgramEnrollment>,
    @InjectRepository(MilestoneAchievement)
    private readonly achievementRepo: Repository<MilestoneAchievement>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  private async findProgram(programId: string, tenantId: string): Promise<Program> {
    const program = await this.programRepo.findOne({
      where: { id: programId, tenant_id: tenantId },
    });
    if (!program) throw new NotFoundException(`Program "${programId}" not found`);
    return program;
  }

  async listForProgram(
    tenantId: string,
    programId: string,
    status?: ProgramEnrollmentStatus,
  ): Promise<
    Array<{
      enrollment: ProgramEnrollment;
      student: Student;
      achieved_count: number;
      milestone_total: number;
    }>
  > {
    await this.findProgram(programId, tenantId);

    const where: Record<string, unknown> = { tenant_id: tenantId, program_id: programId };
    if (status) where.status = status;

    const allEnrollments = await this.enrollmentRepo.find({
      where,
      relations: ['student', 'student.class_section', 'student.class_section.class'],
    });
    // `Student` has @DeleteDateColumn, so the `student` relation join
    // applies `deleted_at IS NULL` — a soft-deleted student's enrollment
    // row survives with `enrollment.student === null`. Drop those rather
    // than crash on `.full_name`.
    const enrollments = allEnrollments.filter((e) => e.student != null);
    // Sort by student name in JS: relation-joined `order` on a related
    // column needs a query-builder join, and this list tops out at a
    // program's roster size, not a paginated table.
    enrollments.sort((a, b) => a.student.full_name.localeCompare(b.student.full_name));

    const milestoneTotal = await this.milestoneRepo.count({
      where: { tenant_id: tenantId, program_id: programId },
    });
    if (enrollments.length === 0) return [];

    const counts = await this.achievementRepo
      .createQueryBuilder('a')
      .select('a.enrollment_id', 'enrollment_id')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.enrollment_id IN (:...ids)', { ids: enrollments.map((e) => e.id) })
      .groupBy('a.enrollment_id')
      .getRawMany<{ enrollment_id: string; count: string }>();
    const countByEnrollmentId = new Map(counts.map((c) => [c.enrollment_id, Number(c.count)]));

    return enrollments.map((enrollment) => ({
      enrollment,
      student: enrollment.student,
      achieved_count: countByEnrollmentId.get(enrollment.id) ?? 0,
      milestone_total: milestoneTotal,
    }));
  }

  /** [D19, D27] Skips students already ACTIVE in this program; the program
   * must itself be active. One transaction, one bulk INSERT with
   * ON CONFLICT DO NOTHING so a concurrent duplicate enrol races safely
   * instead of throwing. */
  async enrol(
    tenantId: string,
    programId: string,
    userId: string | null,
    dto: EnrolStudentsDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<{ created: number; skipped: number }> {
    const program = await this.findProgram(programId, tenantId);
    if (!program.is_active) {
      throw new ConflictException('Cannot enrol students into an archived program');
    }

    const studentIds = [...new Set(dto.student_ids)];
    const students = await this.studentRepo.find({
      where: { id: In(studentIds), tenant_id: tenantId },
    });
    if (students.length !== studentIds.length) {
      const foundIds = new Set(students.map((s) => s.id));
      const missing = studentIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Student(s) not found in this tenant: ${missing.join(', ')}`);
    }

    const startedOn = dto.started_on ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `INSERT INTO program_enrollments
           (tenant_id, program_id, student_id, started_on, status)
         SELECT $1, $2, sid, $3, 'ACTIVE'
         FROM UNNEST($4::uuid[]) AS sid
         ON CONFLICT (program_id, student_id) WHERE status = 'ACTIVE' DO NOTHING
         RETURNING id, student_id`,
        [tenantId, programId, startedOn, studentIds],
      )) as Array<{ id: string; student_id: string }>;

      for (const row of rows) {
        await this.auditService.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'ProgramEnrollment',
            entity_id: row.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: null,
            new_values: {
              program_id: programId,
              student_id: row.student_id,
              started_on: startedOn,
            },
          },
          manager,
        );
      }

      return { created: rows.length, skipped: studentIds.length - rows.length };
    });
  }

  /** [D19] ACTIVE<->COMPLETED/WITHDRAWN sets/clears `ended_on`. Re-activating
   * can collide with the partial unique index (another ACTIVE row already
   * exists for this program+student) — mapped to 409, never a raw 500.
   * Never touches achievements. */
  async updateStatus(
    tenantId: string,
    enrollmentId: string,
    userId: string | null,
    dto: UpdateProgramEnrollmentDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<ProgramEnrollment> {
    const existing = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException(`Enrollment "${enrollmentId}" not found`);

    const endedOn =
      dto.status === ProgramEnrollmentStatus.ACTIVE
        ? null
        : (dto.ended_on ?? new Date().toISOString().slice(0, 10));

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(ProgramEnrollment)
          .update(
            { id: enrollmentId, tenant_id: tenantId },
            { status: dto.status, ended_on: endedOn },
          );

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'ProgramEnrollment',
            entity_id: enrollmentId,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { status: existing.status, ended_on: existing.ended_on },
            new_values: { status: dto.status, ended_on: endedOn },
          },
          manager,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This student already has an active enrolment in this program');
      }
      throw err;
    }

    return this.enrollmentRepo.findOneOrFail({ where: { id: enrollmentId, tenant_id: tenantId } });
  }

  /** [D5, D21] Bulk-upserts one milestone's achievement across every given
   * enrolment via a single `INSERT ... ON CONFLICT DO UPDATE` — not a loop,
   * so 500 enrolments is one round trip and one statement. Recording is
   * allowed even on an archived program (D27) — only the milestone and
   * enrolments need to belong to this program+tenant, any enrolment status. */
  async record(
    tenantId: string,
    programId: string,
    userId: string | null,
    dto: RecordAchievementsDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<{ upserted: number }> {
    await this.findProgram(programId, tenantId);

    const milestone = await this.milestoneRepo.findOne({
      where: { id: dto.milestone_id, program_id: programId, tenant_id: tenantId },
    });
    if (!milestone) throw new NotFoundException(`Milestone "${dto.milestone_id}" not found`);

    const enrollmentIds = [...new Set(dto.enrollment_ids)];
    const enrollments = await this.enrollmentRepo.find({
      where: { id: In(enrollmentIds), program_id: programId, tenant_id: tenantId },
    });
    if (enrollments.length !== enrollmentIds.length) {
      const foundIds = new Set(enrollments.map((e) => e.id));
      const missing = enrollmentIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Enrollment(s) not found in this program: ${missing.join(', ')}`);
    }

    const achievedOn = dto.achieved_on ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO milestone_achievements
           (tenant_id, enrollment_id, milestone_id, achieved_on, recorded_by, score, grade, remark)
         SELECT $1, eid, $2, $3, $4, $5, $6, $7
         FROM UNNEST($8::uuid[]) AS eid
         ON CONFLICT (enrollment_id, milestone_id) DO UPDATE SET
           achieved_on = EXCLUDED.achieved_on,
           recorded_by = EXCLUDED.recorded_by,
           score = EXCLUDED.score,
           grade = EXCLUDED.grade,
           remark = EXCLUDED.remark,
           updated_at = NOW()`,
        [
          tenantId,
          dto.milestone_id,
          achievedOn,
          userId,
          dto.score ?? null,
          dto.grade ?? null,
          dto.remark ?? null,
          enrollmentIds,
        ],
      );

      for (const enrollmentId of enrollmentIds) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'MilestoneAchievement',
            entity_id: enrollmentId,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: null,
            new_values: {
              milestone_id: dto.milestone_id,
              enrollment_id: enrollmentId,
              achieved_on: achievedOn,
              score: dto.score ?? null,
              grade: dto.grade ?? null,
            },
          },
          manager,
        );
      }

      return { upserted: enrollmentIds.length };
    });
  }

  async removeAchievement(
    tenantId: string,
    achievementId: string,
    userId: string | null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<void> {
    const existing = await this.achievementRepo.findOne({
      where: { id: achievementId, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException(`Achievement "${achievementId}" not found`);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(MilestoneAchievement)
        .delete({ id: achievementId, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'MilestoneAchievement',
          entity_id: achievementId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: {
            enrollment_id: existing.enrollment_id,
            milestone_id: existing.milestone_id,
            achieved_on: existing.achieved_on,
          },
          new_values: null,
        },
        manager,
      );
    });
  }

  /** [D8, D24] Every enrolment of this student (any status, newest first)
   * with each milestone's achievement (or null) alongside it — the payload
   * behind the checklist and the portal's `GET /students/:studentId/programs`. */
  async studentPrograms(
    tenantId: string,
    studentId: string,
  ): Promise<
    Array<{
      program: { id: string; name: string; is_active: boolean; show_on_report_card: boolean };
      enrollment: {
        id: string;
        status: ProgramEnrollmentStatus;
        started_on: string;
        ended_on: string | null;
      };
      milestones: Array<{
        id: string;
        name: string;
        sequence: number;
        achievement: {
          id: string;
          achieved_on: string;
          score: string | null;
          grade: string | null;
          remark: string | null;
        } | null;
      }>;
      achieved_count: number;
      milestone_total: number;
    }>
  > {
    const enrollments = await this.enrollmentRepo.find({
      where: { tenant_id: tenantId, student_id: studentId },
      relations: ['program'],
      order: { created_at: 'DESC' },
    });
    if (enrollments.length === 0) return [];

    const programIds = [...new Set(enrollments.map((e) => e.program_id))];
    const milestones = await this.milestoneRepo.find({
      where: { tenant_id: tenantId, program_id: In(programIds) },
      order: { sequence: 'ASC' },
    });
    const milestonesByProgram = new Map<string, ProgramMilestone[]>();
    for (const m of milestones) {
      const list = milestonesByProgram.get(m.program_id) ?? [];
      list.push(m);
      milestonesByProgram.set(m.program_id, list);
    }

    const achievements = await this.achievementRepo.find({
      where: { tenant_id: tenantId, enrollment_id: In(enrollments.map((e) => e.id)) },
    });
    const achievementByKey = new Map(
      achievements.map((a) => [`${a.enrollment_id}:${a.milestone_id}`, a]),
    );

    return enrollments.map((enrollment) => {
      const programMilestones = milestonesByProgram.get(enrollment.program_id) ?? [];
      const milestoneDtos = programMilestones.map((m) => {
        const achievement = achievementByKey.get(`${enrollment.id}:${m.id}`) ?? null;
        return {
          id: m.id,
          name: m.name,
          sequence: m.sequence,
          achievement: achievement
            ? {
                id: achievement.id,
                achieved_on: achievement.achieved_on,
                score: achievement.score,
                grade: achievement.grade,
                remark: achievement.remark,
              }
            : null,
        };
      });

      return {
        program: {
          id: enrollment.program.id,
          name: enrollment.program.name,
          is_active: enrollment.program.is_active,
          show_on_report_card: enrollment.program.show_on_report_card,
        },
        enrollment: {
          id: enrollment.id,
          status: enrollment.status,
          started_on: enrollment.started_on,
          ended_on: enrollment.ended_on,
        },
        milestones: milestoneDtos,
        achieved_count: milestoneDtos.filter((m) => m.achievement !== null).length,
        milestone_total: programMilestones.length,
      };
    });
  }
}
