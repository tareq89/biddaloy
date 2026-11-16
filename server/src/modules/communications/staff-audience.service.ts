import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { teacherCoordinatedClassIds } from '../classes/teacher-scope.service';
import { StaffAudienceDto } from './dto/staff-message.dto';

/** D19: one send reaches at most this many people. */
export const STAFF_AUDIENCE_MAX = 500;
/** One fixed sentence per failure; none ever carries a name, id or phone (Rules 13, 23). */
export const STAFF_AUDIENCE_TOO_MANY = 'Too many people chosen. Pick fewer groups or people.';
export const STAFF_AUDIENCE_EMPTY_PICK = 'Pick at least one group.';
export const STAFF_AUDIENCE_BAD_ROLE = 'That group cannot be messaged.';
export const STAFF_AUDIENCE_NO_CALLER = 'Coordinator scope needs the signed-in user.';

const NOT_STAFF_ROLES: string[] = [UserRole.SUPER_ADMIN, UserRole.PARENT, UserRole.STUDENT];

export interface StaffRecipient {
  user_id: string;
  name: string;
  phone: string;
}
export interface StaffSkipped {
  user_id: string;
  name: string;
  reason: 'no_phone';
}
export interface StaffAudienceResult {
  recipients: StaffRecipient[];
  skipped: StaffSkipped[];
}
export interface StaffAudienceOptions {
  /** D2/D28: narrow to teachers of the classes `callerUserId` coordinates. */
  coordinatedOnly?: boolean;
  callerUserId?: string;
}

/**
 * [80.1.04] Audience -> active members of this school with a phone, plus who was skipped and why.
 * Clone of `ManualAlertsService.resolveRecipientUserIds` (attention module untouched), widened to
 * designations / teaching flag and joined to `users.phone`. Every branch carries `tenant_id` (D20).
 * The sender is not removed (D21).
 */
@Injectable()
export class StaffAudienceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(
    tenantId: string,
    audience: StaffAudienceDto,
    opts: StaffAudienceOptions = {},
  ): Promise<StaffAudienceResult> {
    const roles = audience.roles ?? [];
    const designations = audience.designationIds ?? [];
    const users = audience.userIds ?? [];
    const teaching = audience.teaching ?? null;
    if (roles.some((r) => NOT_STAFF_ROLES.includes(r)))
      throw new BadRequestException(STAFF_AUDIENCE_BAD_ROLE);
    if (!roles.length && !designations.length && !users.length && teaching === null)
      throw new BadRequestException(STAFF_AUDIENCE_EMPTY_PICK);

    let coordinatedClassIds: string[] | null = null;
    if (opts.coordinatedOnly) {
      if (!opts.callerUserId) throw new BadRequestException(STAFF_AUDIENCE_NO_CALLER);
      coordinatedClassIds = await teacherCoordinatedClassIds(this.dataSource.manager, {
        userId: opts.callerUserId,
        tenantId,
      });
      if (!coordinatedClassIds.length) return { recipients: [], skipped: [] };
    }

    const rows: { user_id: string; name: string; phone: string | null }[] =
      await this.dataSource.query(
        `SELECT x.user_id, u.full_name AS name, NULLIF(btrim(u.phone), '') AS phone FROM (
           SELECT ut.user_id FROM user_tenants ut
            WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
           UNION SELECT h.user_id FROM staff_designation_history h
            WHERE h.tenant_id = $1 AND h.end_date IS NULL AND h.status <> 'RESIGNED'
              AND h.designation_id = ANY($3::uuid[])
           UNION SELECT h.user_id FROM staff_designation_history h
             JOIN designations d ON d.id = h.designation_id AND d.tenant_id = $1
              AND d.deleted_at IS NULL
            WHERE h.tenant_id = $1 AND h.end_date IS NULL AND h.status <> 'RESIGNED'
              AND d.is_teaching = $4::boolean
           UNION SELECT ut.user_id FROM user_tenants ut
            WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL
              AND ut.user_id = ANY($5::uuid[]) AND ut.role::text <> ALL($7::text[])
         ) x
         JOIN users u ON u.id = x.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         WHERE EXISTS (SELECT 1 FROM user_tenants m
                        WHERE m.user_id = x.user_id AND m.tenant_id = $1 AND m.deleted_at IS NULL)
           AND ($6::uuid[] IS NULL OR x.user_id IN (
                 SELECT t.user_id FROM teachers t
                   JOIN teacher_class_sections tcs ON tcs.teacher_id = t.id AND tcs.tenant_id = $1
                   JOIN class_sections cs ON cs.id = tcs.section_id AND cs.tenant_id = $1
                    AND cs.deleted_at IS NULL
                  WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
                    AND cs.class_id = ANY($6::uuid[])))
         ORDER BY u.full_name, x.user_id`,
        [tenantId, roles, designations, teaching, users, coordinatedClassIds, NOT_STAFF_ROLES],
      );

    if (rows.length > STAFF_AUDIENCE_MAX) throw new BadRequestException(STAFF_AUDIENCE_TOO_MANY);
    const recipients: StaffRecipient[] = [];
    const skipped: StaffSkipped[] = [];
    for (const r of rows) {
      if (r.phone) recipients.push({ user_id: r.user_id, name: r.name, phone: r.phone });
      else skipped.push({ user_id: r.user_id, name: r.name, reason: 'no_phone' });
    }
    return { recipients, skipped };
  }
}
