import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { StaffProfile } from './entities/staff-profile.entity';

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

    const employeeId = opts?.employeeId ?? (await this.nextEmployeeId(tenantId, repo));
    if (opts?.employeeId) {
      const duplicate = await repo.findOne({
        where: { tenant_id: tenantId, employee_id: opts.employeeId },
      });
      if (duplicate) {
        throw new ConflictException(
          `Staff profile with employee ID "${opts.employeeId}" already exists`,
        );
      }
    }

    const profile = repo.create({
      user_id: userId,
      tenant_id: tenantId,
      employee_id: employeeId,
      joining_date: opts?.joiningDate ?? null,
    });
    return repo.save(profile);
  }
}
