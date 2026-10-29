import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  RoleScope,
  roleScope,
} from '@biddaloy/shared';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { Student } from '../students/entities/student.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { SchoolsService } from '../schools/schools.service';
import type {
  ArrivalSubscriptionResponseDto,
  MyArrivalSubscriptionsDto,
  QueryArrivalSubscriptionsDto,
  StaffArrivalSubscriptionDto,
} from './dto/arrival-subscription.dto';

/** One fixed sentence per refusal; none echoes an id or a submitted value (Rules 23/24). */
export const ARRIVAL_ERRORS = {
  notFound: 'Arrival notice not found',
  studentNotFound: 'Student not found',
  lockedNever: 'Arrival notices are turned off for this child by the school.',
  lockedAlways: 'Arrival notices are always on for this child by the school.',
  lockedForTeacher: 'This arrival notice is locked by the school and cannot be changed.',
  disabled: 'Arrival notices are turned off at this school.',
  smsNotAllowed: 'SMS arrival notices are not available at this school.',
} as const;

/** `canLock` = the caller holds ATTENDANCE_ARRIVAL_NOTICE_LOCK (decided in the controller). */
type Actor = { tenantId: string; userId: string; role: string; canLock: boolean };

function toDto(r: ArrivalNoticeSubscription): ArrivalSubscriptionResponseDto {
  return {
    id: r.id,
    student_id: r.student_id,
    guardian_id: r.guardian_id,
    status: r.status,
    mode: r.mode,
    channel: r.channel,
    lock: r.lock,
    consumed_at: r.consumed_at,
    declined_at: r.declined_at,
    updated_at: r.updated_at,
  };
}

/**
 * [84.2.x] Arrival-notice subscriptions: who is told when a child is marked in.
 * Staff side is scoped by role (a TEACHER only reaches homeroom sections, 404 outside);
 * the portal side only ever reaches the caller's own linked children.
 */
@Injectable()
export class ArrivalSubscriptionsService {
  constructor(
    @InjectRepository(ArrivalNoticeSubscription)
    private readonly repo: Repository<ArrivalNoticeSubscription>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    private readonly teacherScope: TeacherScopeService,
    private readonly schools: SchoolsService,
  ) {}

  // ---- staff ----

  /** `null` = no extra filter; array = the TEACHER's homeroom section ids (may be empty). */
  private async homeroomIds(a: Actor): Promise<string[] | null> {
    if (roleScope(a.role) !== RoleScope.ASSIGNED_SECTIONS) return null;
    const rows = await this.teacherScope.homeroomSections({
      userId: a.userId,
      tenantId: a.tenantId,
    });
    return rows.map((r) => r.section_id);
  }

  /** The school switch gates every write; the portal GET still answers so it can say "off". */
  private async assertEnabled(tenantId: string) {
    const s = (await this.schools.getResolvedSettings(tenantId)).attendance?.arrivalNotice;
    if (!s?.enabled) throw new ConflictException(ARRIVAL_ERRORS.disabled);
  }

  private async assertSmsAllowed(tenantId: string, channel: ArrivalNoticeChannel | undefined) {
    if (channel !== ArrivalNoticeChannel.SMS) return;
    const s = (await this.schools.getResolvedSettings(tenantId)).attendance?.arrivalNotice;
    if (!s?.smsAllowed) throw new ConflictException(ARRIVAL_ERRORS.smsNotAllowed);
  }

  /** NEVER refuses everyone (clear the lock first); any lock refuses a caller without LOCK. */
  private assertStaffMayChange(row: ArrivalNoticeSubscription, canLock: boolean) {
    if (row.lock === ArrivalNoticeLock.NEVER) {
      throw new ConflictException(ARRIVAL_ERRORS.lockedNever);
    }
    if (row.lock !== ArrivalNoticeLock.NONE && !canLock) {
      throw new ForbiddenException(ARRIVAL_ERRORS.lockedForTeacher);
    }
  }

  async listForStaff(
    a: Actor,
    q: QueryArrivalSubscriptionsDto,
  ): Promise<StaffArrivalSubscriptionDto[]> {
    const ids = await this.homeroomIds(a);
    if (ids && q.sectionId && !ids.includes(q.sectionId)) {
      throw new NotFoundException(ARRIVAL_ERRORS.notFound);
    }
    // A teacher with no homeroom section sees an empty list, not a 403.
    if (ids && ids.length === 0) return [];

    const qb = this.repo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.student', 'st', 'st.tenant_id = :tenantId AND st.deleted_at IS NULL')
      .innerJoinAndSelect('s.guardian', 'g', 'g.tenant_id = :tenantId')
      .leftJoin('s.set_by', 'sb')
      .leftJoin('s.locked_by', 'lb')
      .addSelect(['sb.id', 'sb.full_name', 'lb.id', 'lb.full_name'])
      .where('s.tenant_id = :tenantId', { tenantId: a.tenantId })
      .orderBy('st.full_name', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .take(Math.min(q.limit ?? 50, 100))
      .skip(q.offset ?? 0);
    if (q.sectionId) qb.andWhere('st.class_section_id = :sectionId', { sectionId: q.sectionId });
    if (ids) qb.andWhere('st.class_section_id IN (:...ids)', { ids });
    if (q.studentId) qb.andWhere('s.student_id = :studentId', { studentId: q.studentId });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });

    const rows = await qb.getMany();
    return rows.map((r) => ({
      ...toDto(r),
      student_name: r.student.full_name,
      guardian_name: r.guardian.full_name,
      notifications_enabled: r.guardian.notifications_enabled,
      set_by_name: r.set_by?.full_name ?? null,
      set_at: r.set_at,
      locked_by_name: r.locked_by?.full_name ?? null,
      locked_at: r.locked_at,
    }));
  }

  /** Staff adds a row for a guardian; ACTIVE at once (D19). Re-adding re-activates. */
  async createByStaff(
    a: Actor,
    dto: {
      student_id: string;
      guardian_id: string;
      mode: ArrivalNoticeMode;
      channel?: ArrivalNoticeChannel;
    },
  ): Promise<ArrivalSubscriptionResponseDto> {
    await this.assertEnabled(a.tenantId);
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, tenant_id: a.tenantId },
    });
    const ids = await this.homeroomIds(a);
    if (!student || (ids && !ids.includes(student.class_section_id))) {
      throw new NotFoundException(ARRIVAL_ERRORS.studentNotFound);
    }
    const linked = await this.studentRepo
      .createQueryBuilder('st')
      .innerJoin(
        'st.guardians',
        'g',
        'g.id = :gid AND g.tenant_id = :tenantId AND g.deleted_at IS NULL',
        { gid: dto.guardian_id, tenantId: a.tenantId },
      )
      .where('st.id = :sid AND st.tenant_id = :tenantId', {
        sid: dto.student_id,
        tenantId: a.tenantId,
      })
      .getCount();
    if (!linked) throw new NotFoundException(ARRIVAL_ERRORS.studentNotFound);
    await this.assertSmsAllowed(a.tenantId, dto.channel);

    const existing = await this.repo.findOne({
      where: { tenant_id: a.tenantId, student_id: dto.student_id, guardian_id: dto.guardian_id },
    });
    if (existing) this.assertStaffMayChange(existing, a.canLock);
    const row =
      existing ??
      this.repo.create({
        tenant_id: a.tenantId,
        student_id: dto.student_id,
        guardian_id: dto.guardian_id,
        lock: ArrivalNoticeLock.NONE,
      });
    row.status = ArrivalNoticeStatus.ACTIVE;
    row.mode = row.lock === ArrivalNoticeLock.ALWAYS ? ArrivalNoticeMode.RECURRING : dto.mode;
    if (dto.channel) row.channel = dto.channel;
    row.consumed_at = null;
    row.declined_at = null;
    row.set_by_user_id = a.userId;
    row.set_at = new Date();
    return toDto(await this.repo.save(row));
  }

  private async findForStaff(a: Actor, id: string): Promise<ArrivalNoticeSubscription> {
    const row = await this.repo.findOne({ where: { id, tenant_id: a.tenantId } });
    if (!row) throw new NotFoundException(ARRIVAL_ERRORS.notFound);
    const ids = await this.homeroomIds(a);
    if (ids) {
      const st = await this.studentRepo.findOne({
        where: { id: row.student_id, tenant_id: a.tenantId },
      });
      if (!st || !ids.includes(st.class_section_id)) {
        throw new NotFoundException(ARRIVAL_ERRORS.notFound);
      }
    }
    return row;
  }

  /**
   * Confirm (REQUESTED/OFF -> ACTIVE), decline or switch off (-> OFF, D17), and/or change
   * the mode. Declined and switched-off both end OFF with `consumed_at` null.
   */
  async update(
    a: Actor,
    id: string,
    dto: { status?: ArrivalNoticeStatus; mode?: ArrivalNoticeMode },
  ): Promise<ArrivalSubscriptionResponseDto> {
    await this.assertEnabled(a.tenantId);
    const row = await this.findForStaff(a, id);
    this.assertStaffMayChange(row, a.canLock);
    // D35: ALWAYS means ACTIVE + RECURRING; ONCE or OFF would let the row stop on its own.
    if (
      row.lock === ArrivalNoticeLock.ALWAYS &&
      ((dto.status && dto.status !== ArrivalNoticeStatus.ACTIVE) ||
        dto.mode === ArrivalNoticeMode.ONCE)
    ) {
      throw new ConflictException(ARRIVAL_ERRORS.lockedAlways);
    }
    if (dto.status) {
      row.status = dto.status;
      row.consumed_at = null;
      // A staff OFF is a decline; the portal reads it to tell this from the guardian's own OFF.
      row.declined_at = dto.status === ArrivalNoticeStatus.OFF ? new Date() : null;
    }
    if (dto.mode) {
      row.mode = dto.mode;
      // Only a ONCE row can be spent (DB CHECK).
      if (dto.mode !== ArrivalNoticeMode.ONCE) row.consumed_at = null;
    }
    row.set_by_user_id = a.userId;
    row.set_at = new Date();
    return toDto(await this.repo.save(row));
  }

  /** D35: NEVER -> OFF, ALWAYS -> ACTIVE + RECURRING, NONE leaves the row as it is. */
  async setLock(
    a: Actor,
    id: string,
    lock: ArrivalNoticeLock,
  ): Promise<ArrivalSubscriptionResponseDto> {
    await this.assertEnabled(a.tenantId);
    const row = await this.findForStaff(a, id);
    row.lock = lock;
    row.locked_by_user_id = lock === ArrivalNoticeLock.NONE ? null : a.userId;
    row.locked_at = lock === ArrivalNoticeLock.NONE ? null : new Date();
    if (lock === ArrivalNoticeLock.NEVER) {
      row.status = ArrivalNoticeStatus.OFF;
      row.consumed_at = null;
      row.declined_at = null;
    } else if (lock === ArrivalNoticeLock.ALWAYS) {
      row.status = ArrivalNoticeStatus.ACTIVE;
      row.declined_at = null;
      row.mode = ArrivalNoticeMode.RECURRING;
      row.consumed_at = null;
    }
    return toDto(await this.repo.save(row));
  }

  // ---- portal (guardian) ----

  /** The caller's own children: students linked through a guardian row carrying their user id. */
  private linkedChildren(tenantId: string, guardianUserId: string, studentId?: string) {
    const qb = this.studentRepo
      .createQueryBuilder('st')
      .innerJoin(
        'st.guardians',
        'g',
        'g.user_id = :uid AND g.tenant_id = :tenantId AND g.deleted_at IS NULL',
        { uid: guardianUserId, tenantId },
      )
      .select('st.id', 'student_id')
      .addSelect('st.full_name', 'student_name')
      .addSelect('g.id', 'guardian_id')
      .where('st.tenant_id = :tenantId AND st.deleted_at IS NULL', { tenantId })
      .orderBy('st.full_name', 'ASC')
      .addOrderBy('st.id', 'ASC');
    if (studentId) qb.andWhere('st.id = :studentId', { studentId });
    return qb;
  }

  async getMine(tenantId: string, guardianUserId: string): Promise<MyArrivalSubscriptionsDto> {
    const [settings, children] = await Promise.all([
      this.schools.getResolvedSettings(tenantId),
      this.linkedChildren(tenantId, guardianUserId).getRawMany<{
        student_id: string;
        student_name: string;
        guardian_id: string;
      }>(),
    ]);
    const rows = children.length
      ? await this.repo.find({
          where: children.map((c) => ({
            tenant_id: tenantId,
            student_id: c.student_id,
            guardian_id: c.guardian_id,
          })),
        })
      : [];
    return {
      school: {
        enabled: settings.attendance?.arrivalNotice?.enabled ?? false,
        smsAllowed: settings.attendance?.arrivalNotice?.smsAllowed ?? false,
      },
      children: children.map((c) => {
        const row = rows.find(
          (r) => r.student_id === c.student_id && r.guardian_id === c.guardian_id,
        );
        return {
          student_id: c.student_id,
          student_name: c.student_name,
          subscription: row ? toDto(row) : null,
        };
      }),
    };
  }

  /**
   * Guardian turns notices on (REQUESTED, or stays ACTIVE) or off. 404 unless linked.
   * Returns `null` for `want = false` when there was never a row.
   */
  async upsertByGuardian(input: {
    tenantId: string;
    guardianUserId: string;
    studentId: string;
    want: boolean;
    channel?: ArrivalNoticeChannel;
  }): Promise<ArrivalSubscriptionResponseDto | null> {
    const { tenantId, studentId, want, channel } = input;
    const child = await this.linkedChildren(tenantId, input.guardianUserId, studentId).getRawOne<{
      guardian_id: string;
    }>();
    if (!child) throw new NotFoundException(ARRIVAL_ERRORS.studentNotFound);
    await this.assertEnabled(tenantId);
    if (want) await this.assertSmsAllowed(tenantId, channel);

    const row = await this.repo.findOne({
      where: { tenant_id: tenantId, student_id: studentId, guardian_id: child.guardian_id },
    });
    if (row?.lock === ArrivalNoticeLock.NEVER) {
      throw new ConflictException(ARRIVAL_ERRORS.lockedNever);
    }
    if (row?.lock === ArrivalNoticeLock.ALWAYS && !want) {
      throw new ConflictException(ARRIVAL_ERRORS.lockedAlways);
    }
    if (!row && !want) return null;

    const next =
      row ??
      this.repo.create({
        tenant_id: tenantId,
        student_id: studentId,
        guardian_id: child.guardian_id,
        lock: ArrivalNoticeLock.NONE,
        mode: ArrivalNoticeMode.RECURRING,
        status: ArrivalNoticeStatus.REQUESTED,
      });
    if (!want) {
      next.status = ArrivalNoticeStatus.OFF;
      next.consumed_at = null;
      next.declined_at = null; // the guardian's own OFF is not a staff decline
    } else if (next.status === ArrivalNoticeStatus.OFF) {
      // D20: asking again (after a decline or a consumed ONCE) is a fresh request.
      next.status = ArrivalNoticeStatus.REQUESTED;
      next.consumed_at = null;
      next.declined_at = null;
    }
    if (channel) next.channel = channel;
    next.set_by_user_id = input.guardianUserId;
    next.set_at = new Date();
    return toDto(await this.repo.save(next));
  }
}
