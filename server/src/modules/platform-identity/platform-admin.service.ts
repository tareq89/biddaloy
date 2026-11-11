import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserStatus } from '@biddaloy/shared';
import { PlatformAdmin } from './entities/platform-admin.entity';

export interface PlatformOwnerRow {
  user_id: string;
  status: UserStatus;
  email: string | null;
  phone: string | null;
  locked_by: string | null;
  locked_at: Date | null;
}

/** [Epic 98] Read side of the owners table. Lock and unlock arrive in Wave 3. */
@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectRepository(PlatformAdmin) private readonly admins: Repository<PlatformAdmin>,
  ) {}

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return this.admins.exists({ where: { user_id: userId } });
  }

  async listOwners(): Promise<PlatformOwnerRow[]> {
    const rows = await this.admins.find({
      relations: { user: true },
      order: { created_at: 'ASC', user_id: 'ASC' },
    });
    return rows.map((r) => ({
      user_id: r.user_id,
      status: r.user.status,
      email: r.user.email,
      phone: r.user.phone,
      locked_by: r.locked_by,
      locked_at: r.locked_at,
    }));
  }

  /**
   * Ids of the ACTIVE owners, read after a share lock on every owner row. A lock or unlock in
   * flight holds those rows FOR UPDATE (platform-owners.service.ts), so it commits first and this
   * never answers with the state from before it. Same row order as lock(), so no deadlock. Pass
   * `em` to keep the lock until that transaction's own write commits.
   */
  async activeOwnerIds(em?: EntityManager): Promise<string[]> {
    const read = async (m: EntityManager) => {
      await m.query(`SELECT 1 FROM platform_admins ORDER BY user_id FOR SHARE`);
      // A second statement: under READ COMMITTED it sees what the lock it waited on committed.
      const rows: { user_id: string }[] = await m.query(
        `SELECT pa.user_id FROM platform_admins pa JOIN users u ON u.id = pa.user_id
          WHERE u.status = $1 ORDER BY pa.user_id`,
        [UserStatus.ACTIVE],
      );
      return rows.map((r) => r.user_id);
    };
    return em ? read(em) : this.admins.manager.transaction(read);
  }
}
