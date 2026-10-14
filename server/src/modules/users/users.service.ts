import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In, QueryFailedError, type EntityManager } from 'typeorm';
import { hashPassword } from '../auth/password-hash';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { escapeLikePattern } from '../../common/utils/escape-like.util';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import { normalizeEmail, normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  AlertCategory,
  AuditAction,
  EMPLOYEE_ROLES,
  GUARDIAN_ROLES,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { School } from '../schools/entities/school.entity';
import { DEFAULT_ATTENTION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
import type {
  UpdateNotificationPrefsDto,
  NotificationPrefsDto,
} from './dto/notification-prefs.dto';
import { AuditService } from '../audit/audit.service';
import { AccessTokenDenylistService } from '../auth/access-token-denylist.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { ACCESS_TOKEN_TTL_MS } from '../auth/auth-tokens';
import { assertPasswordAllowed } from '../auth/password-policy';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateOwnProfileDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';
import { ASSIGNMENT_TYPE_ORDER_SQL } from '../classes/classes.service';
import type { SectionTeacherAssignment } from '../classes/classes.service';

/** [#1026 gap fix] `getTeacherAssignments`'s row shape — `SectionTeacherAssignment`
 * plus `class_id`/`class_name`, since a teacher-centric list spans multiple
 * classes and its `DataTable` needs a class column to disambiguate. */
export interface SectionTeacherAssignmentWithClass extends SectionTeacherAssignment {
  class_id: string;
  class_name: string;
}

/**
 * Marks a row a workbook role swap ended (`users.tab`): not a departure, so it
 * never makes anyone "former" and `restore()` never revives it (r2-m1).
 */
export const ROLE_SWAP_ENDED = 'ROLE_SWAP';
const NOT_SWAPPED_SQL = `(b.metadata->>'ended_by') IS DISTINCT FROM '${ROLE_SWAP_ENDED}'`;

/**
 * How many live memberships `userId` holds in schools other than `tenantId`.
 * > 0 means the login (email/phone/password) is shared, so no single school
 * may change it. [68.1.#2209]
 */
export async function countOtherMemberships(
  m: EntityManager,
  userId: string,
  tenantId: string,
): Promise<number> {
  return m
    .getRepository(UserTenant)
    .createQueryBuilder('ut')
    .where('ut.user_id = :userId AND ut.tenant_id <> :tenantId', { userId, tenantId })
    .getCount();
}

/**
 * Brings a soft-deleted membership back and drops its `ended_by` tag, so a
 * later real removal of it counts as a departure again. Every path that
 * revives a `user_tenants` row goes through here. Returns 0 when the row was
 * not deleted (someone else revived it first).
 */
export async function reviveMembership(m: EntityManager, id: string): Promise<number> {
  const result = await m
    .createQueryBuilder()
    .update(UserTenant)
    .set({ deleted_at: null, metadata: () => `metadata - 'ended_by'` })
    .where('id = :id AND deleted_at IS NOT NULL', { id })
    .execute();
  return result.affected ?? 0;
}

/** A soft-deleted row from the user's latest end-of-membership batch in `:tenantId`. */
const LATEST_ENDED_SQL = `ut.deleted_at = (SELECT max(b.deleted_at) FROM user_tenants b
  WHERE b.user_id = u.id AND b.tenant_id = :tenantId AND ${NOT_SWAPPED_SQL})`;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly staffProfilesService: StaffProfilesService,
    private readonly audit: AuditService,
    private readonly accessTokenDenylist: AccessTokenDenylistService,
    @Inject(ACCESS_TOKEN_TTL_MS) private readonly accessTokenTtlMs: number,
    private readonly sessionCutoff: SessionCutoffService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** [67.5.03] Own push mute + the school's (read-only) quiet hours. */
  async getNotificationPrefs(userId: string, tenantId: string): Promise<NotificationPrefsDto> {
    const user = await this.findOne(userId, tenantId); // proves membership
    const valid = new Set<string>(Object.values(AlertCategory));
    const raw = user.preferences?.notifications?.mutedCategories;
    const mutedCategories = (Array.isArray(raw) ? raw : []).filter((c) =>
      valid.has(c),
    ) as AlertCategory[];
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    const { quietHours } =
      resolveTenantSettings(school?.settings ?? null).attention ?? DEFAULT_ATTENTION_SETTINGS;
    return { mutedCategories, quietHours: { start: quietHours.start, end: quietHours.end } };
  }

  /**
   * [67.5.03] One atomic jsonb merge so sibling keys (`dashboard`, `digest`,
   * other `notifications.*`) survive a concurrent write. `users.preferences`
   * is per account, so the mute applies in every school the user belongs to.
   */
  async updateNotificationPrefs(
    userId: string,
    tenantId: string,
    dto: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsDto> {
    await this.findOne(userId, tenantId);
    await this.userRepo.query(
      `UPDATE users
          SET preferences = COALESCE(preferences, '{}'::jsonb)
                || jsonb_build_object('notifications',
                     -- a non-object (array/scalar) would turn || into array concat
                     CASE WHEN jsonb_typeof(preferences->'notifications') = 'object'
                          THEN preferences->'notifications' ELSE '{}'::jsonb END
                     || jsonb_build_object('mutedCategories', $2::jsonb)),
              updated_at = now()
        WHERE id = $1`,
      [userId, JSON.stringify(dto.mutedCategories)],
    );
    return this.getNotificationPrefs(userId, tenantId);
  }

  async create(
    dto: CreateUserDto,
    tenantId: string,
    // [13.3.2] The staff import passes its own per-row transaction.
    manager?: EntityManager,
  ): Promise<{ user: User; membership: UserTenant }> {
    // #731: SUPER_ADMIN is a platform role (seeded on the platform tenant),
    // never grantable through a tenant-scoped endpoint. Checked here, the one
    // place that writes a membership role from request input, so no caller
    // can skip it.
    if (dto.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'The SUPER_ADMIN role cannot be assigned through this endpoint',
      );
    }
    // Stored lowercased, so this pre-check and the DB's case-sensitive
    // unique index agree with each other and with login. See normalizeEmail.
    const email = dto.email ? normalizeEmail(dto.email) : null;

    // Check for duplicate email. `withDeleted` because the unique index does
    // not care about soft-deletion but TypeORM's default filter does: without
    // it, an email still owned by a soft-deleted row passes this check and
    // then fails at `save()` as an unmapped 500. Same reasoning as `update()`.
    if (email) {
      const existing = await (manager?.getRepository(User) ?? this.userRepo).findOne({
        where: { email },
        withDeleted: true,
      });
      if (existing) {
        throw new ConflictException('That email address or phone number is already in use');
      }
    }

    let password_hash: string | null = null;
    if (dto.password) {
      // D10: same strength rules as every other password path.
      assertPasswordAllowed(dto.password, [dto.role]);
      password_hash = await hashPassword(dto.password);
    }

    try {
      const work = async (m: EntityManager) => {
        const manager = m;
        const userRepo = manager.getRepository(User);
        const userTenantRepo = manager.getRepository(UserTenant);

        const user = userRepo.create({
          email,
          phone: dto.phone ?? null,
          password_hash,
          full_name: dto.full_name,
        });
        const savedUser = await userRepo.save(user);

        const membership = userTenantRepo.create({
          user_id: savedUser.id,
          tenant_id: tenantId,
          role: dto.role,
        });
        const savedMembership = await userTenantRepo.save(membership);

        // [36.2.1] Every non-teacher staff role gets a generic staff_profiles
        // row here, in the same transaction as the User/UserTenant insert.
        // TEACHER is deliberately excluded: TeacherService.create makes its
        // own staff_profiles row later, reusing the Teacher's own
        // employee_id (mirrors the [36.1.1] migration backfill, which did
        // the same for pre-existing teachers) — creating one here too would
        // hit the per-school `UQ_staff_profiles_tenant_user` key.
        // COMMITTEE is deliberately absent (D16): not an employee, so not in
        // EMPLOYEE_ROLES. SUPER_ADMIN is refused above (#731).
        if (dto.role !== UserRole.TEACHER && EMPLOYEE_ROLES.includes(dto.role)) {
          await this.staffProfilesService.createFor(savedUser.id, tenantId, {}, manager);
        }

        return { user: savedUser, membership: savedMembership };
      };
      return await (manager ? work(manager) : this.userRepo.manager.transaction(work));
    } catch (err) {
      // The pre-check above is not atomic: two concurrent creates claiming the
      // same address both pass it and the loser hits the index. Map that to a
      // 409 rather than a 500, exactly as `update()` does. `phone` has no
      // pre-check at all, so this is its only guard.
      // Only a clash on `users` is an email/phone clash. Any other one (a
      // double-submitted "Add staff" racing on user_tenants, a staff_profiles id)
      // is still a 409, not a 500.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        if ((err.driverError as { table?: string } | undefined)?.table === 'users') {
          throw new ConflictException('That email address or phone number is already in use');
        }
        throw new ConflictException('This member was just added. Refresh and try again.');
      }
      throw err;
    }
  }

  async findAll(query: QueryUserDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Two-phase (IDs, then hydrate) — see the identical comment on
    // StudentService.findAll. TypeORM's pagination-with-joins path can't
    // resolve a `COLLATE`-suffixed `orderBy` expression against its
    // select-alias map, regardless of the join's cardinality — it throws
    // trying to read `column.databaseName` for a "column" that isn't a
    // plain `alias.property`. `u.user_tenants` is one-to-many even though
    // this query's `ut.tenant_id` filter narrows it to one row per user.
    // Former members are soft-deleted `user_tenants` rows: TypeORM hides them
    // from joins unless `withDeleted()`, and `ut.deleted_at IS NOT NULL` then
    // keeps only them. `u.deleted_at IS NULL` below still excludes dead accounts.
    const former = query.membership === 'former';
    const buildIdQuery = () => {
      // `withDeleted()` must come before the join: TypeORM bakes the
      // soft-delete filter into the join's ON clause when the join is added.
      const base = this.userRepo.createQueryBuilder('u');
      const qb = (former ? base.withDeleted() : base)
        .select('u.id', 'id')
        .innerJoin('u.user_tenants', 'ut')
        .where('u.deleted_at IS NULL')
        .andWhere('ut.tenant_id = :tenantId', { tenantId });
      if (former) {
        // Same rule as `restore()`: the rows of the latest end-of-membership
        // batch, for a user with no active STAFF role here. A TEACHER who left
        // but is still a PARENT here (D16) is former; one who is staff again is not.
        qb.andWhere(LATEST_ENDED_SQL).andWhere(
          `NOT EXISTS (SELECT 1 FROM user_tenants a
             WHERE a.user_id = u.id AND a.tenant_id = :tenantId AND a.deleted_at IS NULL
               AND a.role NOT IN (:...guardianRoles))`,
          { guardianRoles: [...GUARDIAN_ROLES] },
        );
      }

      if (query.role) {
        qb.andWhere('ut.role = :role', { role: query.role });
      }

      if (query.status) {
        qb.andWhere('u.status = :status', { status: query.status });
      }

      // "Joined date" for a tenant-scoped staff directory means when this
      // user joined *this* school (UserTenant.created_at), not when their
      // account was created globally (User.created_at).
      if (query.joined_from) {
        qb.andWhere('ut.created_at >= :joinedFrom', { joinedFrom: query.joined_from });
      }
      if (query.joined_to) {
        // A date-only value must include the whole day, matching the
        // pattern used elsewhere for to_date filters (e.g.
        // AuditService.findAll, BulkReminderService.findBatches) — without
        // this, `joined_to: '2026-01-01'` truncates to midnight on this
        // `timestamptz` column and excludes everyone who joined later that
        // same day.
        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.joined_to);
        const joinedTo = new Date(query.joined_to);
        if (isDateOnly) {
          joinedTo.setUTCHours(23, 59, 59, 999);
        }
        qb.andWhere('ut.created_at <= :joinedTo', { joinedTo });
      }

      const search = normalizeSearchTerm(query.search);
      if (search) {
        qb.andWhere(
          '(u.full_name ILIKE :search OR u.email ILIKE :search OR u.phone ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      // [23.12] Current-designation filter — an `EXISTS` against the raw
      // `staff_designation_history` table (23.2), same "reach for the raw
      // table name rather than import that module's entity" choice the
      // `invitation_status` filter above makes for `auth_tokens`: this
      // avoids a cross-module entity import between `users` and
      // `staff-hr`. "Current" means the open row — `end_date IS NULL` —
      // same definition `StaffHrController`'s designation-history read
      // and `HrRecordPromotionSection`'s "Current" badge both use.
      if (query.designation_id) {
        qb.andWhere(
          `EXISTS (
            SELECT 1 FROM staff_designation_history sdh
            WHERE sdh.user_id = u.id
              AND sdh.tenant_id = :tenantId
              AND sdh.end_date IS NULL
              AND sdh.designation_id = :designationId
          )`,
          { designationId: query.designation_id },
        );
      }

      // Filter on the derived invitation lifecycle (12.6) — a lateral join
      // to the newest INVITE `auth_tokens` row for this user, then a CASE
      // expression that mirrors `deriveInvitationStatus` exactly (see the
      // paired unit test asserting the two never drift).
      if (query.invitation_status) {
        qb.leftJoin(
          (subQb) =>
            subQb
              .select('t.user_id', 'user_id')
              .addSelect('t.consumed_at', 'consumed_at')
              .addSelect('t.revoked_at', 'revoked_at')
              .addSelect('t.expires_at', 'expires_at')
              .distinctOn(['t.user_id'])
              .from('auth_tokens', 't')
              .where("t.purpose = 'INVITE' AND t.tenant_id = :tenantId", { tenantId })
              .orderBy('t.user_id')
              .addOrderBy('t.created_at', 'DESC'),
          'inv',
          'inv.user_id = u.id',
        );
        qb.andWhere(
          `(CASE
            WHEN u.password_hash IS NOT NULL OR inv.consumed_at IS NOT NULL THEN 'ACTIVATED'
            WHEN inv.user_id IS NULL THEN 'NONE'
            WHEN inv.revoked_at IS NOT NULL THEN 'REVOKED'
            WHEN inv.expires_at < NOW() THEN 'EXPIRED'
            ELSE 'PENDING'
          END) = :invitationStatus`,
          { invitationStatus: query.invitation_status },
        );
      }

      return qb;
    };

    const total = await buildIdQuery().getCount();

    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(
        `u.full_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else if (query.sort === 'email') {
      idQb.orderBy('u.email', query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'joined_at') {
      idQb.orderBy('MIN(ut.created_at)', query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'status') {
      idQb.orderBy('u.status', query.order === 'desc' ? 'DESC' : 'ASC');
    } else {
      // Default order kept as-is so existing pages do not reshuffle.
      idQb.orderBy('u.created_at', 'DESC');
    }
    // One row per user: a user with several role rows here (or a removal that
    // ended several) must not repeat. `getCount()` already counts distinct ids.
    idQb.groupBy('u.id').addOrderBy('u.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    // `innerJoinAndSelect` + a tenant filter here, not `relations:
    // ['user_tenants']` on a plain `find()` — a user who belongs to more
    // than one tenant must only have *this* tenant's membership row
    // hydrated onto the response, matching the original single-query
    // behavior and not leaking another tenant's membership metadata.
    const hydrateBase = this.userRepo.createQueryBuilder('u');
    const hydrate = (former ? hydrateBase.withDeleted() : hydrateBase)
      .innerJoinAndSelect('u.user_tenants', 'ut', 'ut.tenant_id = :tenantId', { tenantId })
      .where('u.id IN (:...ids)', { ids });
    if (former) hydrate.andWhere(LATEST_ENDED_SQL);
    const rows = await hydrate.getMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is User => row != null);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, tenantId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, deleted_at: IsNull() },
      relations: ['user_tenants'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    // Verify user has a membership in this tenant
    const membership = user.user_tenants?.find((ut) => ut.tenant_id === tenantId);
    if (!membership) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  /**
   * [75.1, D3] For an admin edit of a person who also belongs to another school:
   * the email/phone values that would actually change, to be proposed to the
   * person instead of written. `null` = nothing to propose (no contact change,
   * or a single-school user, whose edit `update()` applies directly).
   */
  async sharedIdentifierChanges(
    id: string,
    dto: UpdateUserDto,
    tenantId: string,
  ): Promise<{ email?: string | null; phone?: string | null } | null> {
    const current = await this.findOne(id, tenantId); // keeps the 404 for a non-member
    const changes: { email?: string | null; phone?: string | null } = {};
    if (dto.email !== undefined) {
      const email = dto.email ? normalizeEmail(dto.email) : null;
      if (email !== (current.email ?? null)) changes.email = email;
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone ? normalizeLoginIdentifier(dto.phone) : null;
      const stored = current.phone ? normalizeLoginIdentifier(current.phone) : null;
      if (phone !== stored) changes.phone = phone;
    }
    if (Object.keys(changes).length === 0) return null;
    if ((await countOtherMemberships(this.userRepo.manager, id, tenantId)) === 0) return null;
    // Same login-identifier invariant as `update()`, on the state the approval would produce.
    const nextEmail = 'email' in changes ? changes.email : current.email;
    const nextPhone = 'phone' in changes ? changes.phone : current.phone;
    if (!nextEmail && !nextPhone) {
      throw new BadRequestException(
        'An account must keep at least one login identifier — set an email address or a phone number before clearing the other',
      );
    }
    return changes;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    tenantId: string,
    // Required: identity edits are audited and the audit row names the actor.
    actorUserId: string,
  ): Promise<User> {
    const current = await this.findOne(id, tenantId);

    // `''` means "clear this column" (a browser form submits a cleared input
    // that way). It must become a real NULL: `''` is a value as far as the
    // UNIQUE index is concerned, so storing it would let only one user ever
    // have a blank phone. [5.4a]
    const phone =
      dto.phone === '' || dto.phone === null
        ? null
        : dto.phone && normalizeLoginIdentifier(dto.phone);
    // Compare with the stored value normalised the same way (review m3), as
    // `sharedIdentifierChanges` does: a legacy row saved before phones were
    // normalised must not look changed when the form re-sends the same number.
    const storedPhone = current.phone ? normalizeLoginIdentifier(current.phone) : null;

    // Same gesture, same meaning for email: `''` is a cleared form input, not
    // an address. Everything else is lowercased before it is compared OR
    // written — a case-sensitive `character varying` unique index cannot tell
    // `foo@example.com` from `Foo@example.com`, so without this the
    // "already in use" pre-check below misses case variants and the index
    // does not catch them either. [5.4a]
    const email =
      dto.email === '' || dto.email === null
        ? null
        : dto.email
          ? normalizeEmail(dto.email)
          : undefined;

    // Login-identifier invariant. `AuthService.validateUser` looks a caller up
    // by email OR phone and nothing else, and there is no password-reset flow,
    // so a user left with neither is permanently locked out of every school
    // they belong to. `@IsOptional()` skips validation for `null`, so
    // `{"email": null, "phone": null}` sails through the DTO — and `''` is
    // normalized to NULL just above, so `{"phone": ""}` on a user with no
    // email is the same hazard. Decide on the POST-UPDATE state: the DTO's
    // values merged over the row as it stands. This lives in the service, not
    // the controller, because admin `PATCH /users/:id` can do it just as
    // easily as self-service `PATCH /users/me`. [5.4a]
    // Scoped to updates that actually touch an identifier: a row that already
    // has neither (users can be created without one — see `create()`) is not
    // made any worse by a `full_name` edit, and blocking that would be
    // collateral damage rather than protection.
    const touchesIdentifier = dto.email !== undefined || dto.phone !== undefined;
    // Run twice: here to fail fast, and again on the row-locked copy inside the transaction,
    // since a concurrent update may have cleared the other identifier since `current` was read.
    const assertKeepsIdentifier = (row: Pick<User, 'email' | 'phone'>) => {
      const nextEmail = dto.email !== undefined ? email : row.email;
      const nextPhone = dto.phone !== undefined ? phone : row.phone;
      if (touchesIdentifier && !nextEmail && !nextPhone) {
        throw new BadRequestException(
          'An account must keep at least one login identifier — set an email address or a phone number before clearing the other',
        );
      }
    };
    assertKeepsIdentifier(current);

    // One login serves every school the person belongs to, so a school may not
    // retarget it: that would let this school's admin reset the password and
    // sign in as the person in the other school. [68.1.#2209, TEN-01]
    const emailChanges = dto.email !== undefined && (email ?? null) !== (current.email ?? null);
    const phoneChanges = dto.phone !== undefined && (phone ?? null) !== storedPhone;
    if (
      (emailChanges || phoneChanges) &&
      (await countOtherMemberships(this.userRepo.manager, id, tenantId)) > 0
    ) {
      throw new ConflictException({
        message:
          'This person also belongs to another school. Only they can change their email or phone, from their own profile.',
        details: { code: 'SHARED_IDENTITY' },
      });
    }

    // `email` and `phone` are globally unique (see User entity). Without a
    // pre-check the DB unique index surfaces as a raw 500 — tolerable when
    // only admins could call this, not for the self-service `/users/me`
    // route. `withDeleted` because the constraint does not care about
    // soft-deletion but TypeORM's default filter does. The message names no
    // account and no tenant: email/phone are unique GLOBALLY, so the owner
    // of a colliding value may well be in another school. [5.4a]
    if (email) {
      const existing = await this.userRepo.findOne({
        where: { email },
        withDeleted: true,
      });
      // Postgres `uuid` compares case-insensitively and `users/:id` carries no
      // `ParseUUIDPipe`, so an uppercase route id must not make a user look
      // like a different account from themselves — that would turn a resubmit
      // of their own unchanged email into a spurious 409. Same guard, and the
      // same reason, as `remove()` below.
      if (existing && existing.id.toLowerCase() !== id.toLowerCase()) {
        throw new ConflictException('That email address is already in use');
      }
    }
    if (phone) {
      const existing = await this.userRepo.findOne({
        where: { phone },
        withDeleted: true,
      });
      // See the case-folding note on the email pre-check above.
      if (existing && existing.id.toLowerCase() !== id.toLowerCase()) {
        throw new ConflictException('That phone number is already in use');
      }
    }

    // Update user-level fields (shared across tenants)
    const updateData: any = {};
    // [12.7] Any admin edit to email/phone clears the matching
    // `*_verified_at` — this IS the "explicit unverified flag" the plan
    // calls for, not an extra boolean column. Compared against the
    // CURRENT stored value, not just "field present in the body": a
    // profile-form resubmit of the same unchanged address must not wipe
    // out a real verification.
    if (dto.email !== undefined && (email ?? null) !== (current.email ?? null)) {
      updateData.email = email ?? null;
      updateData.email_verified_at = null;
    } else if (dto.email !== undefined) {
      updateData.email = email ?? null;
    }
    if (phoneChanges) {
      updateData.phone = phone;
      updateData.phone_verified_at = null;
    } else if (dto.phone !== undefined) {
      updateData.phone = phone;
    }
    if (dto.full_name !== undefined) updateData.full_name = dto.full_name;
    if (dto.profile_picture_url !== undefined)
      updateData.profile_picture_url = dto.profile_picture_url;
    if (Object.keys(updateData).length > 0) {
      try {
        await this.userRepo.manager.transaction(async (manager) => {
          // Lock the row, then diff against it: two admins editing the same field at once must
          // each audit the value they actually replaced, not the one both read before the lock.
          const locked = await manager
            .getRepository(User)
            .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
          if (locked) assertKeepsIdentifier(locked);
          // Only email/phone/full_name are identity; picture edits are not audited.
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const key of ['email', 'phone', 'full_name'] as const) {
            if (key in updateData && updateData[key] !== (locked?.[key] ?? null)) {
              before[key] = locked?.[key] ?? null;
              after[key] = updateData[key];
            }
          }
          await manager.getRepository(User).update({ id }, updateData);
          if (Object.keys(after).length > 0) {
            await this.audit.record(
              {
                action: AuditAction.UPDATE,
                entity_type: 'User',
                entity_id: id,
                tenant_id: tenantId,
                performed_by_user_id: actorUserId,
                old_values: before,
                new_values: after,
              },
              manager,
            );
          }
        });
      } catch (err) {
        // The pre-check above is not atomic: two concurrent updates claiming
        // the same address both pass it and the loser hits the index. Map
        // that to the same 409 rather than a 500.
        // Same shape the bulk-upload service uses for 23505 (unique_violation).
        if (
          err instanceof QueryFailedError &&
          (err as unknown as { code?: string }).code === '23505'
        ) {
          throw new ConflictException('That email address or phone number is already in use');
        }
        throw err;
      }
    }

    // [75.1] A written email/phone change (single-school user: a shared one never gets here)
    // ends every session, so whoever held the old contact is out.
    if (emailChanges || phoneChanges) {
      // Revoke first: a refresh that rotates before the revoke then mints a token older than the cut-off.
      await this.refreshTokens.revokeAllForUser(id);
      await this.sessionCutoff.cutOff(id);
    }

    return this.findOne(id, tenantId);
  }

  /**
   * `PATCH /users/me`. [12.7]: `email`/`phone` no longer go through this
   * route at all — `UpdateOwnProfileDto` no longer has fields for them, so
   * `forbidNonWhitelisted` (the global `ValidationPipe`) 400s a caller who
   * still sends either before this method ever runs. Changing a contact now
   * goes through `ContactChangeService` (`account-access/contact-change.service.ts`),
   * which commits only after the new value is proven owned — no
   * `current_password` re-auth gate is needed here any more, since nothing
   * security-sensitive remains in this DTO.
   */
  async updateOwnProfile(id: string, dto: UpdateOwnProfileDto, tenantId: string): Promise<User> {
    return this.update(id, dto, tenantId, id);
  }

  async remove(id: string, tenantId: string, requestingUserId: string): Promise<void> {
    // Trust-boundary guard: an admin must never be able to lock themselves
    // out of the school. The UI disables the action too, but the server is
    // the boundary that matters.
    // Postgres uuid columns compare case-insensitively, so an uppercase
    // self-UUID in the route must not slip past a string comparison.
    if (id.toLowerCase() === requestingUserId.toLowerCase()) {
      throw new BadRequestException('You cannot remove your own account from this school');
    }

    await this.findOne(id, tenantId);
    await this.endMembership(id, tenantId, requestingUserId, 'REMOVE');
  }

  /**
   * `POST users/me/leave` [13.2.1, D16]: a staff member leaves a school. Only
   * the membership is soft-deleted (the account and its other schools stay).
   * Guardians and students have no "leave" — the school manages them.
   */
  async leave(userId: string, tenantId: string): Promise<void> {
    const rows = await this.userTenantRepo.find({
      where: { user_id: userId, tenant_id: tenantId },
    });
    if (rows.length === 0) {
      throw new NotFoundException('You are not a member of this school');
    }
    const cannotLeave = [UserRole.PARENT, UserRole.STUDENT, UserRole.SUPER_ADMIN];
    // D16: only staff-role memberships end; a TEACHER who is also a PARENT keeps that row.
    const staffRoles = rows.map((r) => r.role).filter((r) => !cannotLeave.includes(r));
    if (staffRoles.length === 0) {
      throw new ForbiddenException({
        message: 'Your role cannot leave this school',
        details: { code: 'LEAVE_NOT_ALLOWED' },
      });
    }
    await this.endMembership(userId, tenantId, userId, 'LEAVE', staffRoles);
  }

  /**
   * `POST users/:id/restore`: bring a former member back (same rows, same ids).
   * Only the rows ended by the LATEST end-of-membership event come back: one
   * `softDelete` stamps all its rows with the same transaction timestamp, so
   * `deleted_at = max(deleted_at)` is exactly that batch. Older soft-deleted
   * rows (a role a workbook swap replaced, a role the user left earlier) stay
   * ended. "Former" means no active staff role: a TEACHER who left but is
   * still a PARENT here (D16) can be restored.
   *
   * [13.3.2] With `role`, the staff import restores only that role's former row.
   */
  async restore(id: string, tenantId: string, actorUserId: string, role?: UserRole): Promise<void> {
    await this.userTenantRepo.manager.transaction(async (manager) => {
      // A soft-deleted account cannot be brought back through its membership.
      if (!(await manager.getRepository(User).findOne({ where: { id } }))) {
        throw new NotFoundException(`No former member with ID "${id}" found`);
      }
      const repo = manager.getRepository(UserTenant);
      if (
        await repo.count({
          // With or without `role`: no restore for someone who still holds a staff role here.
          where: { user_id: id, tenant_id: tenantId, role: Not(In([...GUARDIAN_ROLES])) },
        })
      ) {
        throw new ConflictException({
          message: 'This user is already a member of this school',
          details: { code: 'ALREADY_MEMBER' },
        });
      }
      // An update rather than `.restore()`, so a row a workbook swap tagged loses the tag.
      const qb = repo
        .createQueryBuilder()
        .update()
        .set({ deleted_at: null, metadata: () => `metadata - 'ended_by'` })
        .where('user_id = :id AND tenant_id = :tenantId', { id, tenantId });
      const result = await (
        role
          ? qb.andWhere('role = :role AND deleted_at IS NOT NULL', { role })
          : qb.andWhere(
              `deleted_at = (SELECT max(b.deleted_at) FROM user_tenants b
                            WHERE b.user_id = :id AND b.tenant_id = :tenantId AND ${NOT_SWAPPED_SQL})`,
            )
      ).execute();
      if (!result.affected) {
        throw new NotFoundException(`No former member with ID "${id}" found`);
      }
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Membership',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          new_values: { operation: 'RESTORE', user_id: id },
        },
        manager,
      );
    });
  }

  /**
   * Soft-deletes every membership row of `userId` in the tenant, refusing when
   * that would leave the school without an ADMIN ("a school always has an
   * admin"). The ADMIN rows are locked so two admins leaving at once cannot
   * both pass the count. Always `UserTenant` repo calls — never `save()` a
   * `User` with `user_tenants` loaded (TypeORM would orphan soft-deleted rows).
   */
  private async endMembership(
    userId: string,
    tenantId: string,
    actorUserId: string,
    operation: 'LEAVE' | 'REMOVE',
    roles?: UserRole[],
  ): Promise<void> {
    await this.userTenantRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(UserTenant);
      // Only admins who can actually sign in count: a deactivated or deleted
      // account keeps its ADMIN row but cannot run the school. The lock stays
      // on the membership rows (`FOR UPDATE OF ut`).
      // ponytail: users.status is not locked; an admin deactivated mid-leave can still slip past.
      const admins = await repo
        .createQueryBuilder('ut')
        .innerJoin('ut.user', 'u')
        .where('ut.tenant_id = :tenantId AND ut.role = :role', {
          tenantId,
          role: UserRole.ADMIN,
        })
        .andWhere('u.deleted_at IS NULL AND u.status = :active', { active: UserStatus.ACTIVE })
        .orderBy('ut.id', 'ASC') // deterministic lock order
        .setLock('pessimistic_write', undefined, ['ut'])
        .getMany();
      const isAdmin = admins.some((a) => a.user_id.toLowerCase() === userId.toLowerCase());
      const endsAdmin = isAdmin && (!roles || roles.includes(UserRole.ADMIN));
      if (endsAdmin && admins.length === 1) {
        throw new ConflictException({
          message: 'A school must keep at least one admin. Add another admin first.',
          details: { code: 'LAST_ADMIN' },
        });
      }
      // `deleted_at: IsNull()`: softDelete does not skip ended rows, and
      // re-stamping one would pull it into this batch for `restore()`.
      const ended = await repo.softDelete({
        user_id: userId,
        tenant_id: tenantId,
        deleted_at: IsNull(),
        ...(roles ? { role: In(roles) } : {}),
      });
      // A concurrent leave/remove already ended it: no second 204, no second audit row.
      if (!ended.affected) {
        throw new NotFoundException(`No current member with ID "${userId}" found`);
      }
      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Membership',
          entity_id: userId,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          new_values: { operation, user_id: userId },
        },
        manager,
      );
    });
    // After commit. "Membership ended => tokens dead" must hold even if one step fails, so the
    // Redis cut-off runs in `finally`: a DB error from `cutOff` still propagates, but cannot skip it.
    try {
      // [75.2] Durable DB cut-off, after commit so a token minted while the transaction was
      // open (a refresh still sees the membership) is older than it. JwtStrategy reads it.
      await this.sessionCutoff.cutOff(userId);
    } finally {
      // Every token the user already holds is refused, so removal is immediate (D16).
      // The client's 401 -> refresh drops the school.
      await this.accessTokenDenylist.revokeUserTokensIssuedBefore(
        userId,
        new Date(),
        this.accessTokenTtlMs,
      );
    }
  }
}

@Injectable()
export class TeacherService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    private readonly staffProfilesService: StaffProfilesService,
  ) {}

  async create(
    // `employee_id` is optional for the staff import ([13.3.2]): left out, the staff profile
    // generates one and the Teacher row reuses it.
    dto: Omit<CreateTeacherDto, 'employee_id'> & { employee_id?: string },
    tenantId: string,
    // [13.3.2] The staff import runs user + teacher in one per-row transaction.
    outer?: EntityManager,
  ): Promise<Teacher> {
    const m = outer ?? this.userRepo.manager;
    const userRepo = m.getRepository(User);
    const userTenantRepo = m.getRepository(UserTenant);
    const teacherRepo = m.getRepository(Teacher);
    const user = await userRepo.findOne({
      where: { id: dto.user_id, deleted_at: IsNull() },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${dto.user_id}" not found`);
    }

    // Verify user is a member of this tenant
    const membership = await userTenantRepo.findOne({
      where: { user_id: dto.user_id, tenant_id: tenantId },
    });
    if (!membership) {
      throw new BadRequestException(`User "${dto.user_id}" is not a member of this tenant`);
    }

    // A user can hold at most one teacher profile per school (unique index on
    // teachers (tenant_id, user_id)) — guard here so the client sees a mapped
    // 409 instead of a raw DB constraint error. The promote dialog's
    // client-side exclusion only sees the first 100 teachers.
    const existingProfile = await teacherRepo.findOne({
      where: { user_id: dto.user_id, tenant_id: tenantId },
    });
    if (existingProfile) {
      throw new ConflictException({
        message: `User "${dto.user_id}" already has a teacher profile`,
        details: { code: 'ALREADY_TEACHER_HERE' },
      });
    }

    // [36.2.1] Teacher's own employee_id also seeds its staff_profiles row
    // (attendance/leave key off staff_profile_id, not the Teacher table) —
    // same reuse the [36.1.1] migration backfill did for pre-existing
    // teachers. Profile creation, Teacher save, and section assignment all
    // run in one transaction so a failure anywhere in this method (e.g. the
    // section-assignment validation) can't leave an orphaned staff_profiles
    // or Teacher row that then blocks retry via createFor's "already has a
    // staff profile" / "already has a teacher profile" guards.
    const joiningDate = dto.joining_date ? new Date(dto.joining_date) : null;
    const work = async (manager: EntityManager) => {
      // An ADMIN / ACCOUNTANT / EXECUTIVE already has this school's staff
      // profile (UserService.create makes one): promoting them reuses it, and
      // the Teacher takes its employee_id, not the typed one. So check the id
      // that is actually written, or a clash with a teacher whose id was
      // edited away from its staff profile surfaces as a raw 23505. Read
      // inside the transaction so the check and the insert see the same row.
      const reusedProfile = await manager.findOne(StaffProfile, {
        where: { user_id: dto.user_id, tenant_id: tenantId },
      });
      const employeeId = reusedProfile?.employee_id ?? dto.employee_id;
      const existing = employeeId
        ? await manager.findOne(Teacher, {
            where: { employee_id: employeeId, tenant_id: tenantId },
          })
        : null;
      if (existing) {
        // Rule 23: name the field, never echo the value. A reused profile's
        // id is not the typed one, so it gets its own code: the dialog must
        // not blame the field the admin typed.
        throw new ConflictException(
          reusedProfile
            ? {
                message: "This person's staff employee ID is already used by another teacher",
                details: { code: 'STAFF_EMPLOYEE_ID_TAKEN' },
              }
            : 'That employee ID is already in use',
        );
      }

      // Reuse that staff profile; anyone else gets a new one.
      const staffProfile =
        reusedProfile ??
        (await this.staffProfilesService.createFor(
          dto.user_id,
          tenantId,
          { employeeId: dto.employee_id, joiningDate },
          manager,
        ));

      const teacher = manager.create(Teacher, {
        user_id: dto.user_id,
        employee_id: staffProfile.employee_id,
        designations: dto.designations ?? [],
        subject_specialization: dto.subject_specialization ?? null,
        joining_date: joiningDate,
        tenant_id: tenantId,
        staff_profile_id: staffProfile.id,
      });
      const teacherSaved = await manager.save(teacher);

      return teacherSaved;
    };
    const savedTeacher = await (outer ? work(outer) : this.userRepo.manager.transaction(work));

    return teacherRepo.findOne({
      where: { id: savedTeacher.id },
      relations: ['user'],
    }) as Promise<Teacher>;
  }

  async findAll(query: QueryTeacherDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.teacherRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.user', 'u')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.deleted_at IS NULL');

    if (query.search) {
      qb.andWhere('u.full_name ILIKE :search', { search: `%${escapeLikePattern(query.search)}%` });
    }

    if (query.user_id) {
      qb.andWhere('t.user_id = :userId', { userId: query.user_id });
    }

    const total = await qb.getCount();
    qb.orderBy('t.created_at', 'DESC').skip(skip).take(limit);
    const data = await qb.getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Teacher> {
    const teacher = await this.teacherRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['user'],
    });
    if (!teacher) {
      throw new NotFoundException(`Teacher with ID "${id}" not found`);
    }
    return teacher;
  }

  async update(id: string, dto: UpdateTeacherDto, tenantId: string): Promise<Teacher> {
    await this.findOne(id, tenantId);

    const updateData: any = {};
    if (dto.employee_id !== undefined) updateData.employee_id = dto.employee_id;
    if (dto.designations !== undefined) updateData.designations = dto.designations;
    if (dto.subject_specialization !== undefined)
      updateData.subject_specialization = dto.subject_specialization;
    // `null` clears the joining date — `new Date(null)` would silently
    // store the Unix epoch instead.
    if (dto.joining_date !== undefined)
      updateData.joining_date = dto.joining_date === null ? null : new Date(dto.joining_date);

    await this.teacherRepo.update({ id, tenant_id: tenantId }, updateData);

    return this.teacherRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['user'],
    }) as Promise<Teacher>;
  }

  /** [29.0] Every section this teacher is assigned to, class-teacher and
   * subject-teacher rows alike — same join/shape as
   * `SectionService.listSectionTeachers`, keyed by `teacher_id` instead
   * of `section_id`, for the Staff detail tab.
   *
   * [#1026 gap fix] Unlike wave-3's other two screens, the Staff detail
   * tab has no fixed class/section in scope, so its `DataTable` needs a
   * `class` column — `SectionTeacherAssignment` (used as-is by the
   * section-scoped screens) doesn't carry that, so this returns the wider
   * `SectionTeacherAssignmentWithClass` shape instead of touching that interface. */
  async getTeacherAssignments(
    teacherId: string,
    tenantId: string,
  ): Promise<SectionTeacherAssignmentWithClass[]> {
    await this.findOne(teacherId, tenantId);

    const rows = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoinAndSelect('tcs.teacher', 'teacher')
      .innerJoinAndSelect('teacher.user', 'user')
      .innerJoinAndSelect('tcs.section', 'section')
      .innerJoinAndSelect('section.class', 'class')
      .leftJoinAndSelect('tcs.subject', 'subject')
      .where('tcs.teacher_id = :teacherId', { teacherId })
      .andWhere('tcs.tenant_id = :tenantId', { tenantId })
      .orderBy(ASSIGNMENT_TYPE_ORDER_SQL, 'ASC')
      .addOrderBy('user.full_name', 'ASC')
      .getMany();

    return rows.map((row) => ({
      id: row.id,
      teacher_id: row.teacher_id,
      employee_id: row.teacher.employee_id,
      full_name: row.teacher.user.full_name,
      section_id: row.section_id,
      section_name: row.section.section_name,
      class_id: row.section.class_id,
      class_name: row.section.class.name,
      subject_id: row.subject_id,
      subject_name: row.subject?.name_en ?? null,
      assignment_type: row.assignment_type,
    }));
  }
}
