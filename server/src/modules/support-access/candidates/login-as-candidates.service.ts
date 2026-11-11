import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  UserRole,
  UserStatus,
  type LoginAsCandidateDto,
  type LoginAsCandidatesResponse,
} from '@biddaloy/shared';
import { normalizeSearchTerm } from '../../../common/utils/normalize-search-term.util';
import { School } from '../../schools/entities/school.entity';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';

interface Row {
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
}

/** [99.2.06] D2/D34/D26: people the owner can pick for Login as, with a reason when not usable. */
@Injectable()
export class LoginAsCandidatesService {
  constructor(
    private readonly ds: DataSource,
    private readonly settings: SchoolSettingsReader,
  ) {}

  async list(
    schoolId: string,
    role: UserRole,
    q: string | undefined,
    limit: number,
  ): Promise<LoginAsCandidatesResponse> {
    const school = await this.ds.getRepository(School).findOne({
      where: { id: schoolId },
      select: { id: true, status: true },
    });
    if (!school) throw new NotFoundException('School not found');

    const term = normalizeSearchTerm(q);
    const [rows, access, admins] = await Promise.all([
      this.rows(schoolId, role, term ? `%${term}%` : null, limit),
      this.settings.supportAccessFresh(schoolId),
      this.ds
        .createQueryBuilder()
        .select('1')
        .from('user_tenants', 'ut')
        .innerJoin('users', 'u', 'u.id = ut.user_id AND u.deleted_at IS NULL')
        .where('ut.tenant_id = :schoolId AND ut.role = :admin AND ut.deleted_at IS NULL', {
          schoolId,
          admin: UserRole.ADMIN,
        })
        .andWhere('u.status = :active', { active: UserStatus.ACTIVE })
        .limit(1)
        .getRawMany(),
    ]);

    return {
      candidates: rows.map((r) => this.toDto(r, role)),
      noActiveAdmin: admins.length === 0,
      schoolStatus: school.status,
      supportAccessMode: access.mode,
    };
  }

  private toDto(r: Row, role: UserRole): LoginAsCandidateDto {
    const unavailableReason = !r.user_id
      ? 'NO_LOGIN_ACCOUNT'
      : r.status !== UserStatus.ACTIVE
        ? 'INACTIVE'
        : null;
    return {
      userId: r.user_id,
      name: r.name,
      role,
      email: r.email,
      phone: r.phone,
      unavailableReason,
    };
  }

  private rows(schoolId: string, role: UserRole, search: string | null, limit: number) {
    const qb = this.ds.createQueryBuilder();
    // Student and parent come from the school's own table (they may have no user row).
    const own = role === UserRole.STUDENT || role === UserRole.PARENT;
    if (own) {
      const isStudent = role === UserRole.STUDENT;
      qb.select('p.user_id', 'user_id')
        .addSelect('p.full_name', 'name')
        .addSelect(isStudent ? 'u.email' : 'COALESCE(u.email, p.email)', 'email')
        .addSelect(isStudent ? 'u.phone' : 'COALESCE(u.phone, p.phone)', 'phone')
        .addSelect('u.status', 'status')
        .from(isStudent ? 'students' : 'guardians', 'p')
        .leftJoin('users', 'u', 'u.id = p.user_id AND u.deleted_at IS NULL')
        .where('p.tenant_id = :schoolId AND p.deleted_at IS NULL', { schoolId });
    } else {
      qb.select('u.id', 'user_id')
        .addSelect('u.full_name', 'name')
        .addSelect('u.email', 'email')
        .addSelect('u.phone', 'phone')
        .addSelect('u.status', 'status')
        .from('user_tenants', 'ut')
        .innerJoin('users', 'u', 'u.id = ut.user_id AND u.deleted_at IS NULL')
        .where('ut.tenant_id = :schoolId AND ut.role = :role AND ut.deleted_at IS NULL', {
          schoolId,
          role,
        });
    }
    if (search) {
      const nameCol = own ? 'p.full_name' : 'u.full_name';
      qb.andWhere(`(${nameCol} ILIKE :s OR u.email ILIKE :s OR u.phone ILIKE :s)`, { s: search });
    }
    return qb
      .orderBy('u.last_login_at', 'DESC', 'NULLS LAST')
      .addOrderBy('name', 'ASC')
      .limit(limit)
      .getRawMany<Row>();
  }
}
