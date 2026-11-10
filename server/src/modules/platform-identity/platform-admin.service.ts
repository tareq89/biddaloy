import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async countActive(): Promise<number> {
    return this.admins.count({ where: { user: { status: UserStatus.ACTIVE } } });
  }
}
