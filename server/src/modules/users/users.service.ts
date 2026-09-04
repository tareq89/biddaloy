import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { escapeLikePattern } from '../../common/utils/escape-like.util';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import { normalizeEmail } from '../auth/normalize-identifier';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateOwnProfileDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';

/**
 * Compared against when the caller has no password hash, so a passwordless
 * account costs the same bcrypt time as a wrong password rather than
 * answering instantly. Mirrors AuthService's dummy hash. It is not a hash of
 * any real password.
 */
const DUMMY_PASSWORD_HASH = '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
  ) {}

  async create(
    dto: CreateUserDto,
    tenantId: string,
  ): Promise<{ user: User; membership: UserTenant }> {
    // Stored lowercased, so this pre-check and the DB's case-sensitive
    // unique index agree with each other and with login. See normalizeEmail.
    const email = dto.email ? normalizeEmail(dto.email) : null;

    // Check for duplicate email. `withDeleted` because the unique index does
    // not care about soft-deletion but TypeORM's default filter does: without
    // it, an email still owned by a soft-deleted row passes this check and
    // then fails at `save()` as an unmapped 500. Same reasoning as `update()`.
    if (email) {
      const existing = await this.userRepo.findOne({ where: { email }, withDeleted: true });
      if (existing) {
        throw new ConflictException(`User with email "${email}" already exists`);
      }
    }

    let password_hash: string | null = null;
    if (dto.password) {
      password_hash = await bcrypt.hash(dto.password, 10);
    }

    try {
      return await this.userRepo.manager.transaction(async (manager) => {
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

        return { user: savedUser, membership: savedMembership };
      });
    } catch (err) {
      // The pre-check above is not atomic: two concurrent creates claiming the
      // same address both pass it and the loser hits the index. Map that to a
      // 409 rather than a 500, exactly as `update()` does. `phone` has no
      // pre-check at all, so this is its only guard.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('That email address or phone number is already in use');
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
    const buildIdQuery = () => {
      const qb = this.userRepo
        .createQueryBuilder('u')
        .select('u.id', 'id')
        .innerJoin('u.user_tenants', 'ut')
        .where('u.deleted_at IS NULL')
        .andWhere('ut.tenant_id = :tenantId', { tenantId });

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

      return qb;
    };

    const total = await buildIdQuery().getCount();

    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(`u.full_name COLLATE "${BN_COLLATION}"`, query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'email') {
      idQb.orderBy('u.email', query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'joined_at') {
      idQb.orderBy('ut.created_at', query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'status') {
      idQb.orderBy('u.status', query.order === 'desc' ? 'DESC' : 'ASC');
    } else {
      // Default order kept as-is so existing pages do not reshuffle.
      idQb.orderBy('u.created_at', 'DESC');
    }
    idQb.addOrderBy('u.id', 'ASC').offset(skip).limit(limit);

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
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.user_tenants', 'ut', 'ut.tenant_id = :tenantId', { tenantId })
      .where('u.id IN (:...ids)', { ids })
      .getMany();
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

  async update(id: string, dto: UpdateUserDto, tenantId: string): Promise<User> {
    const current = await this.findOne(id, tenantId);

    // `''` means "clear this column" (a browser form submits a cleared input
    // that way). It must become a real NULL: `''` is a value as far as the
    // UNIQUE index is concerned, so storing it would let only one user ever
    // have a blank phone. [5.4a]
    const phone = dto.phone === '' ? null : dto.phone;

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
    const nextEmail = dto.email !== undefined ? email : current.email;
    const nextPhone = dto.phone !== undefined ? phone : current.phone;
    if (touchesIdentifier && !nextEmail && !nextPhone) {
      throw new BadRequestException(
        'An account must keep at least one login identifier — set an email address or a phone number before clearing the other',
      );
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
    if (dto.email !== undefined) updateData.email = email ?? null;
    if (dto.phone !== undefined) updateData.phone = phone;
    if (dto.full_name !== undefined) updateData.full_name = dto.full_name;
    if (dto.profile_picture_url !== undefined)
      updateData.profile_picture_url = dto.profile_picture_url;
    if (Object.keys(updateData).length > 0) {
      try {
        await this.userRepo.update({ id }, updateData);
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

    return this.findOne(id, tenantId);
  }

  /**
   * `PATCH /users/me`. Same write as `update()`, with one extra gate: if the
   * request actually CHANGES a login identifier, it must carry the caller's
   * current password.
   *
   * Why: an access token lives ~15 minutes, there is no password-reset flow,
   * and `AuthService.validateUser` matches on email OR phone and nothing
   * else — so whoever rewrites both identifiers owns the account and the real
   * user is locked out of every school they belong to, forever. That is the
   * same stake `POST /auth/change-password` protects with `current_password`.
   * Cosmetic fields (`full_name`, `profile_picture_url`) stay friction-free.
   *
   * "Changes" is compared against the stored values, so re-submitting your
   * own unchanged email (what a profile form does on every save) costs
   * nothing.
   *
   * 403, not 401: `ui/src/api/client.ts` transparently refreshes and replays
   * ANY 401 once, which would turn a wrong password into a silent double
   * submit. Admin `PATCH /users/:id` deliberately does not go through here —
   * an admin does not know the password of the person they are editing. [5.4a]
   */
  async updateOwnProfile(id: string, dto: UpdateOwnProfileDto, tenantId: string): Promise<User> {
    const { current_password, ...rest } = dto;
    const current = await this.findOne(id, tenantId);

    const nextEmail =
      rest.email === '' || rest.email === null
        ? null
        : rest.email
          ? normalizeEmail(rest.email)
          : undefined;
    const nextPhone = rest.phone === '' ? null : rest.phone;

    const changesEmail = nextEmail !== undefined && nextEmail !== (current.email ?? null);
    const changesPhone = nextPhone !== undefined && nextPhone !== (current.phone ?? null);

    if (changesEmail || changesPhone) {
      if (!current_password) {
        throw new BadRequestException(
          'Changing your email address or phone number requires your current password',
        );
      }
      // A user created without a password (invited, never set one) cannot
      // prove anything — same stance changePassword takes. Constant work
      // either way so this is not a "has a password?" oracle.
      const hash = current.password_hash ?? DUMMY_PASSWORD_HASH;
      const valid = await bcrypt.compare(current_password, hash);
      if (!current.password_hash || !valid) {
        throw new ForbiddenException('Current password is incorrect');
      }
    }

    return this.update(id, rest, tenantId);
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

    // Remove only the tenant membership, not the global user record
    await this.userTenantRepo.delete({ user_id: id, tenant_id: tenantId });
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
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
  ) {}

  async create(dto: CreateTeacherDto, tenantId: string): Promise<Teacher> {
    const user = await this.userRepo.findOne({
      where: { id: dto.user_id, deleted_at: IsNull() },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${dto.user_id}" not found`);
    }

    // Verify user is a member of this tenant
    const membership = await this.userTenantRepo.findOne({
      where: { user_id: dto.user_id, tenant_id: tenantId },
    });
    if (!membership) {
      throw new BadRequestException(`User "${dto.user_id}" is not a member of this tenant`);
    }

    // A user can hold at most one teacher profile (unique index on
    // teachers.user_id) — guard here so the client sees a mapped 409
    // instead of a raw DB constraint error. The promote dialog's
    // client-side exclusion only sees the first 100 teachers.
    const existingProfile = await this.teacherRepo.findOne({
      where: { user_id: dto.user_id },
    });
    if (existingProfile) {
      throw new ConflictException(`User "${dto.user_id}" already has a teacher profile`);
    }

    // Check for duplicate employee_id
    const existing = await this.teacherRepo.findOne({
      where: { employee_id: dto.employee_id },
    });
    if (existing) {
      throw new ConflictException(`Teacher with employee ID "${dto.employee_id}" already exists`);
    }

    const teacher = this.teacherRepo.create({
      user_id: dto.user_id,
      employee_id: dto.employee_id,
      designations: dto.designations ?? [],
      subject_specialization: dto.subject_specialization ?? null,
      joining_date: dto.joining_date ? new Date(dto.joining_date) : null,
      tenant_id: tenantId,
    });
    const savedTeacher = await this.teacherRepo.save(teacher);

    // Assign sections if provided
    if (dto.assigned_section_ids?.length) {
      // Validate all sections belong to tenant
      const sectionCount = await this.sectionRepo.count({
        where: {
          id: In(dto.assigned_section_ids),
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (sectionCount !== dto.assigned_section_ids.length) {
        throw new NotFoundException('One or more assigned sections not found');
      }

      const tcsEntries = dto.assigned_section_ids.map((sectionId) =>
        this.tcsRepo.create({
          teacher_id: savedTeacher.id,
          section_id: sectionId,
        }),
      );
      await this.tcsRepo.save(tcsEntries);
    }

    return this.teacherRepo.findOne({
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

    // Replace assigned sections if provided
    if (dto.assigned_section_ids !== undefined) {
      await this.tcsRepo.delete({ teacher_id: id });

      if (dto.assigned_section_ids.length > 0) {
        // Validate all sections belong to tenant
        const sectionCount = await this.sectionRepo.count({
          where: {
            id: In(dto.assigned_section_ids),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        });
        if (sectionCount !== dto.assigned_section_ids.length) {
          throw new NotFoundException('One or more assigned sections not found');
        }

        const tcsEntries = dto.assigned_section_ids.map((sectionId) =>
          this.tcsRepo.create({
            teacher_id: id,
            section_id: sectionId,
          }),
        );
        await this.tcsRepo.save(tcsEntries);
      }
    }

    return this.teacherRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['user'],
    }) as Promise<Teacher>;
  }
}
