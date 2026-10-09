import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ApplicationStatus, ApplicationType, LeaveStatus } from '@biddaloy/shared';
import { SCHOOL_TZ, todayInSchoolTz } from '../../common/time';
import { Application } from './entities/application.entity';
import { formatApplicationSerial } from './application-serial';
import { ReviewerScopeService, type ApplicationCaller } from './reviewer-scope';
import type {
  ApplicationReportsDto,
  PendingCountDto,
  ReportsQueryDto,
  StaffLeaveDaysRowDto,
} from './dto/reports.dto';

const STALE_DAYS = 3;
const STALE_LIMIT = 50;
// SCHOOL_TZ is a code constant, so it is safe to inline (a bind param would not match GROUP BY).
const MONTH_EXPR = `to_char(a.created_at AT TIME ZONE '${SCHOOL_TZ}', 'YYYY-MM')`;

/** [52.3.5] Inbox count and the admin reports. Every query filters `tenant_id`, joins included. */
@Injectable()
export class ApplicationReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reviewerScope: ReviewerScopeService,
  ) {}

  private apps(tenantId: string): SelectQueryBuilder<Application> {
    return this.dataSource
      .getRepository(Application)
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId });
  }

  /** Same predicate as `view=inbox` (applyInbox), never a second copy of the rules. */
  async pendingCount(tenantId: string, user: ApplicationCaller): Promise<PendingCountDto> {
    const qb = this.apps(tenantId).leftJoin(
      'students',
      's',
      's.id = a.subject_student_id AND s.tenant_id = a.tenant_id',
    );
    await this.reviewerScope.applyInbox(qb, tenantId, user);
    const rows = await qb
      .select('a.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MIN(a.created_at)', 'oldest')
      .groupBy('a.type')
      .orderBy('a.type')
      .getRawMany<{ type: ApplicationType; count: string; oldest: Date }>();

    const by_type = rows.map((r) => ({ type: r.type, count: Number(r.count) }));
    const oldest = rows.map((r) => new Date(r.oldest).getTime());
    return {
      total: by_type.reduce((sum, r) => sum + r.count, 0),
      by_type,
      oldest_pending_at: oldest.length > 0 ? new Date(Math.min(...oldest)).toISOString() : null,
    };
  }

  async reports(
    tenantId: string,
    _user: ApplicationCaller,
    q: ReportsQueryDto,
  ): Promise<ApplicationReportsDto> {
    const filtered = () => {
      const qb = this.apps(tenantId);
      if (q.academic_year_id) qb.andWhere('a.academic_year_id = :yr', { yr: q.academic_year_id });
      if (q.from)
        qb.andWhere(`(a.created_at AT TIME ZONE '${SCHOOL_TZ}')::date >= :from`, { from: q.from });
      if (q.to)
        qb.andWhere(`(a.created_at AT TIME ZONE '${SCHOOL_TZ}')::date <= :to`, { to: q.to });
      return qb;
    };
    const decided = [ApplicationStatus.APPROVED, ApplicationStatus.REJECTED];
    const open = [ApplicationStatus.PENDING, ApplicationStatus.UNDER_CONSIDERATION];
    const today = todayInSchoolTz();

    const [byTypeStatus, byMonth, avg, stale, onLeaveStaff, onLeaveStudents, leaveDays] =
      await Promise.all([
        filtered()
          .select('a.type', 'type')
          .addSelect('a.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('a.type')
          .addGroupBy('a.status')
          .orderBy('a.type')
          .addOrderBy('a.status')
          .getRawMany<{ type: ApplicationType; status: ApplicationStatus; count: string }>(),
        filtered()
          .select(MONTH_EXPR, 'month')
          .addSelect('COUNT(*)', 'submitted')
          .addSelect(`COUNT(*) FILTER (WHERE a.status = 'APPROVED')`, 'approved')
          .addSelect(`COUNT(*) FILTER (WHERE a.status = 'REJECTED')`, 'rejected')
          .groupBy(MONTH_EXPR)
          .orderBy('month')
          .getRawMany<{ month: string; submitted: string; approved: string; rejected: string }>(),
        filtered()
          .select('AVG(EXTRACT(EPOCH FROM a.decided_at - a.created_at)) / 3600', 'hours')
          .andWhere('a.status IN (:...decided) AND a.decided_at IS NOT NULL', { decided })
          .getRawOne<{ hours: string | null }>(),
        filtered()
          .leftJoin('users', 'au', 'au.id = a.applicant_user_id')
          .select([
            'a.id AS id',
            'a.serial_year AS serial_year',
            'a.serial_no AS serial_no',
            'a.type AS type',
            'a.current_step AS current_step',
            'a.created_at AS created_at',
          ])
          .addSelect('coalesce(au.full_name, a.applicant_name)', 'applicant_name')
          .andWhere('a.status IN (:...open)', { open })
          .andWhere(`a.created_at < now() - interval '${STALE_DAYS} days'`)
          .orderBy('a.created_at', 'ASC')
          .limit(STALE_LIMIT)
          .getRawMany<{
            id: string;
            serial_year: number;
            serial_no: number;
            type: ApplicationType;
            current_step: number;
            created_at: Date;
            applicant_name: string | null;
          }>(),
        // On leave today ignores the report filters.
        this.dataSource
          .createQueryBuilder()
          .from('leave_records', 'l')
          .innerJoin(
            'staff_profiles',
            'sp',
            'sp.id = l.staff_profile_id AND sp.tenant_id = l.tenant_id',
          )
          .innerJoin('users', 'u', 'u.id = sp.user_id')
          .select('l.staff_profile_id', 'staff_profile_id')
          .addSelect('u.full_name', 'name')
          .addSelect('l.leave_type', 'leave_type')
          .addSelect(`to_char(l.end_date, 'YYYY-MM-DD')`, 'end_date')
          .where('l.tenant_id = :tenantId AND l.status = :st', {
            tenantId,
            st: LeaveStatus.APPROVED,
          })
          .andWhere('l.start_date <= :today AND l.end_date >= :today', { today })
          .orderBy('u.full_name')
          .getRawMany<{
            staff_profile_id: string;
            name: string;
            leave_type: string;
            end_date: string;
          }>(),
        this.apps(tenantId)
          .innerJoin('students', 's', 's.id = a.subject_student_id AND s.tenant_id = a.tenant_id')
          .innerJoin(
            'class_sections',
            'cs',
            'cs.id = s.class_section_id AND cs.tenant_id = a.tenant_id',
          )
          .innerJoin('classes', 'c', 'c.id = cs.class_id AND c.tenant_id = a.tenant_id')
          .select('s.id', 'student_id')
          .addSelect('s.full_name', 'name')
          .addSelect('c.name', 'class_name')
          .addSelect('cs.section_name', 'section_name')
          .addSelect(`to_char(a.end_date, 'YYYY-MM-DD')`, 'end_date')
          .andWhere('a.type = :stype AND a.status = :ast', {
            stype: ApplicationType.STUDENT_LEAVE,
            ast: ApplicationStatus.APPROVED,
          })
          .andWhere('a.start_date <= :today AND a.end_date >= :today', { today })
          .orderBy('s.full_name')
          .getRawMany<{
            student_id: string;
            name: string;
            class_name: string;
            section_name: string;
            end_date: string;
          }>(),
        this.leaveDays(tenantId, q),
      ]);

    return {
      by_type_status: byTypeStatus.map((r) => ({ ...r, count: Number(r.count) })),
      by_month: byMonth.map((r) => ({
        month: r.month,
        submitted: Number(r.submitted),
        approved: Number(r.approved),
        rejected: Number(r.rejected),
      })),
      avg_decision_hours: avg?.hours == null ? null : Math.round(Number(avg.hours) * 10) / 10,
      stale_pending: stale.map((r) => ({
        id: r.id,
        serial: formatApplicationSerial(Number(r.serial_year), Number(r.serial_no)),
        type: r.type,
        applicant_name: r.applicant_name,
        current_step: Number(r.current_step),
        created_at: new Date(r.created_at).toISOString(),
      })),
      on_leave_today: { staff: onLeaveStaff, students: onLeaveStudents },
      staff_leave_days: leaveDays,
    };
  }

  /** Approved leave by start month (a leave crossing a month counts in its start month). */
  private async leaveDays(tenantId: string, q: ReportsQueryDto): Promise<StaffLeaveDaysRowDto[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .from('leave_records', 'l')
      .innerJoin(
        'staff_profiles',
        'sp',
        'sp.id = l.staff_profile_id AND sp.tenant_id = l.tenant_id',
      )
      .innerJoin('users', 'u', 'u.id = sp.user_id')
      .select('l.staff_profile_id', 'staff_profile_id')
      .addSelect('u.full_name', 'name')
      .addSelect('l.leave_type', 'leave_type')
      .addSelect(`to_char(l.start_date, 'YYYY-MM')`, 'month')
      .addSelect('SUM(l.days)', 'days')
      .where('l.tenant_id = :tenantId AND l.status = :st', {
        tenantId,
        st: LeaveStatus.APPROVED,
      });
    if (q.from) qb.andWhere('l.start_date >= :from', { from: q.from });
    if (q.to) qb.andWhere('l.start_date <= :to', { to: q.to });
    const rows = await qb
      .groupBy('l.staff_profile_id')
      .addGroupBy('u.full_name')
      .addGroupBy('l.leave_type')
      .addGroupBy(`to_char(l.start_date, 'YYYY-MM')`)
      .orderBy('u.full_name')
      .getRawMany<{
        staff_profile_id: string;
        name: string;
        leave_type: string;
        month: string;
        days: string;
      }>();

    const byStaff = new Map<string, StaffLeaveDaysRowDto>();
    for (const r of rows) {
      const row = byStaff.get(r.staff_profile_id) ?? {
        staff_profile_id: r.staff_profile_id,
        name: r.name,
        by_type: {},
        by_month: {},
      };
      const days = Number(r.days);
      row.by_type[r.leave_type] = (row.by_type[r.leave_type] ?? 0) + days;
      row.by_month[r.month] = (row.by_month[r.month] ?? 0) + days;
      byStaff.set(r.staff_profile_id, row);
    }
    return [...byStaff.values()];
  }
}
