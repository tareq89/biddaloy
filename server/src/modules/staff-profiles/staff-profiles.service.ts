import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In, QueryFailedError } from 'typeorm';
import { StaffProfile } from './entities/staff-profile.entity';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Bounds the retry loop below — a real collision storm past this many
 * attempts means something other than ordinary concurrent-insert races. */
const MAX_EMPLOYEE_ID_ATTEMPTS = 5;

export interface CreateStaffProfileOptions {
  employeeId?: string;
  joiningDate?: Date | null;
}

@Injectable()
export class StaffProfilesService {
  constructor(
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepo: Repository<StaffProfile>,
  ) {}

  /**
   * Generates the next `EMP-<tenant_short>-<sequence>` id for a tenant —
   * same scheme migration `StaffAttendanceLeave1789800014000` used for its
   * backfill (`server/src/migrations/1789800014000-StaffAttendanceLeave.ts:96`).
   * `<sequence>` is 1-based and counts existing profiles for the tenant.
   */
  private async nextEmployeeId(tenantId: string, repo: Repository<StaffProfile>): Promise<string> {
    const count = await repo.count({ where: { tenant_id: tenantId } });
    return `EMP-${tenantId.slice(0, 8)}-${count + 1}`;
  }

  /**
   * Creates the `staff_profiles` row for a staff user. Pass `manager` to
   * run inside a caller's transaction (e.g. alongside the `User`/`UserTenant`
   * insert in `UserService.create`).
   */
  async createFor(
    userId: string,
    tenantId: string,
    opts?: CreateStaffProfileOptions,
    manager?: EntityManager,
  ): Promise<StaffProfile> {
    const repo = manager ? manager.getRepository(StaffProfile) : this.staffProfileRepo;

    const existingForUser = await repo.findOne({ where: { user_id: userId } });
    if (existingForUser) {
      throw new ConflictException(`User "${userId}" already has a staff profile`);
    }

    if (opts?.employeeId) {
      const duplicate = await repo.findOne({
        where: { tenant_id: tenantId, employee_id: opts.employeeId },
      });
      if (duplicate) {
        throw new ConflictException(
          `Staff profile with employee ID "${opts.employeeId}" already exists`,
        );
      }
      return repo.save(
        repo.create({
          user_id: userId,
          tenant_id: tenantId,
          employee_id: opts.employeeId,
          joining_date: opts?.joiningDate ?? null,
        }),
      );
    }

    // A generated `employee_id` isn't reserved by the `count`-based read
    // above — two concurrent `createFor` calls for the same tenant can
    // both read the same count and then race to insert the same id. That
    // collision is expected and recoverable (retry with a fresh count),
    // not a real conflict worth surfacing to the caller as one.
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_ATTEMPTS; attempt++) {
      const employeeId = await this.nextEmployeeId(tenantId, repo);
      try {
        return await repo.save(
          repo.create({
            user_id: userId,
            tenant_id: tenantId,
            employee_id: employeeId,
            joining_date: opts?.joiningDate ?? null,
          }),
        );
      } catch (error) {
        if (!isUniqueViolationOn(error, 'UQ_staff_profiles_tenant_employee_id')) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  /** Single-user lookup for `staff_profile_id` — used to expose it on `UserResponseDto`. */
  async findIdByUserId(userId: string): Promise<string | null> {
    const profile = await this.staffProfileRepo.findOne({ where: { user_id: userId } });
    return profile?.id ?? null;
  }

  /** Bulk version for list responses — one query instead of N. */
  async findIdsByUserIds(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const profiles = await this.staffProfileRepo.find({ where: { user_id: In(userIds) } });
    return new Map(profiles.map((p) => [p.user_id, p.id]));
  }
}

/** True when `error` is a Postgres unique-violation on `constraintName` —
 * shared by `StaffProfilesService.createFor` and
 * `TeacherStaffProfileSubscriber`, both of which retry past a
 * concurrent-insert collision on the same `employee_id` generation
 * scheme rather than surfacing it as a caller-facing conflict. */
export function isUniqueViolationOn(error: unknown, constraintName: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
  return driverError?.code === UNIQUE_VIOLATION && driverError?.constraint === constraintName;
}
