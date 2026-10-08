import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RequestContext } from '../auth/refresh-token.service';
import { assertPasswordAllowedForUser } from '../auth/password-policy';

const BCRYPT_COST = 10;

/**
 * `POST /account/first-password` — a signed-in user whose account has no
 * password yet (code or invite sign-in) sets one. Never replaces an existing
 * password: that is `change-password`'s job, which asks for the old one.
 */
@Injectable()
export class FirstPasswordService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant) private readonly userTenantRepo: Repository<UserTenant>,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  async set(userId: string, password: string, context: RequestContext): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.password_hash !== null) throw this.alreadySet();

    await assertPasswordAllowedForUser(this.userTenantRepo, userId, password);
    const password_hash = await bcrypt.hash(password, BCRYPT_COST);

    // Conditional write: two racing requests cannot both "set the first password".
    const result = await this.userRepo.update(
      { id: userId, password_hash: IsNull() },
      { password_hash },
    );
    if (result.affected !== 1) throw this.alreadySet();
    // Failed password tries against the password-less account may have locked
    // the login; the new password must work at once (same as activate/change).
    await this.authService.resetLoginLockouts(user);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: await this.authService.primaryTenantId(userId),
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { scope: 'first_password' },
    });
  }

  private alreadySet(): ConflictException {
    return new ConflictException({
      message: 'A password is already set',
      details: { code: 'PASSWORD_ALREADY_SET' },
    });
  }
}
