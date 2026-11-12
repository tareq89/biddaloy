import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { escapeLikePattern } from '../../../common/utils/escape-like.util';
import { AuditService } from '../../audit/audit.service';
import { maskEmail, maskPhone } from '../../account-access/contact-mask.util';
import { normalizeEmail, normalizeLoginIdentifier } from '../../auth/normalize-identifier';
import { RefreshTokenService } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import {
  PLATFORM_USER_SEARCH_MIN,
  type PlatformUserItem,
  type PlatformUserMembership,
} from './dto/platform-users.dto';

const NOT_FOUND = 'Person not found';
const TOO_SHORT = 'Search text is too short';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  last_login_at: Date | null;
}

/** [Epic 99] Owner tool: find a person across all schools and sign them out everywhere. Owners are never visible here. */
@Injectable()
export class PlatformUsersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly cutoff: SessionCutoffService,
    private readonly refresh: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  async search(q: string, limit = 25): Promise<PlatformUserItem[]> {
    const term = normalizeLoginIdentifier(q);
    const take = Math.min(Math.max(limit, 1), 100);
    // Exactly one of the two params is non-null: an email exact match, or a phone suffix pattern.
    let phonePattern: string | null = null;
    let email: string | null = null;
    if (term.includes('@')) {
      email = normalizeEmail(term);
    } else {
      // 880 / +880 / 0 prefixes all reduce to the same national number, matched as a suffix.
      const national = term.replace(/\D/g, '').replace(/^(?:880|0)/, '');
      if (national.length < PLATFORM_USER_SEARCH_MIN) throw new BadRequestException(TOO_SHORT);
      phonePattern = `%${escapeLikePattern(national)}`;
    }
    const users: UserRow[] = await this.ds.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at
         FROM users u
        WHERE (($1::text IS NOT NULL AND u.phone LIKE $1 ESCAPE '\\')
            OR ($2::text IS NOT NULL AND u.email = $2))
          AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id)
        ORDER BY u.full_name, u.id
        LIMIT $3`,
      [phonePattern, email, take],
    );
    if (!users.length) return [];
    const members: (PlatformUserMembership & { userId: string })[] = await this.ds.query(
      `SELECT ut.user_id AS "userId", ut.id AS "memberId", ut.tenant_id AS "schoolId",
              s.name AS "schoolName", ut.role
         FROM user_tenants ut
         JOIN schools s ON s.id = ut.tenant_id AND s.deleted_at IS NULL
        WHERE ut.user_id = ANY($1) AND ut.deleted_at IS NULL
        ORDER BY s.name, ut.role`,
      [users.map((u) => u.id)],
    );
    return users.map((u) => ({
      userId: u.id,
      fullName: u.full_name,
      emailMasked: u.email ? maskEmail(u.email) : null,
      phoneMasked: u.phone ? maskPhone(u.phone) : null,
      status: u.status,
      locked: u.status === UserStatus.SUSPENDED,
      lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
      memberships: members
        .filter((m) => m.userId === u.id)
        .map(({ memberId, schoolId, schoolName, role }) => ({
          memberId,
          schoolId,
          schoolName,
          role,
        })),
    }));
  }

  /** Rule 8: cut-off kills access tokens, revoke kills refresh cookies. Unknown and owner ids answer the same 404. */
  async logout(userId: string, actorId: string): Promise<void> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id)`,
      [userId],
    );
    if (!rows.length) throw new NotFoundException(NOT_FOUND);
    await this.cutoff.cutOff(userId);
    await this.refresh.revokeAllForUser(userId);
    await this.audit.record({
      action: AuditAction.PLATFORM_USER_LOGOUT,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: null,
      performed_by_user_id: actorId,
      new_values: { target_user_id: userId },
    });
  }
}
