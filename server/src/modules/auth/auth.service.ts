import { Injectable, UnauthorizedException, Inject, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { JwtPayload, JwtMembership, LoginResponse, AuditAction } from '@beton-boi/shared';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LoginAttemptService } from './login-attempt.service';
import { normalizeLoginIdentifier } from './normalize-identifier';

// Precomputed bcrypt hash of an arbitrary, non-secret string — never the
// hash of a real password. Used as the compare target when no user is
// found, so validateUser always pays bcrypt's cost. Without this, "no such
// user" returns near-instantly while "wrong password" takes ~bcrypt-cost
// time — a timing oracle that lets an attacker enumerate valid identifiers
// without ever seeing a different response body.
const DUMMY_PASSWORD_HASH = '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.';

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepository: Repository<UserTenant>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(LoginAttemptService) private readonly loginAttempts: LoginAttemptService,
    // Inject JwtStrategy to force eager creation — PassportModule needs it
    // to discover the strategy for AuthGuard('jwt').
    @Optional() @Inject(JwtStrategy) private readonly _jwtStrategy?: JwtStrategy,
  ) {}

  async validateUser(emailOrPhone: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: [
        { email: emailOrPhone },
        { phone: emailOrPhone },
      ],
    });

    const hashToCompare = user?.password_hash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.password_hash || !isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(
    emailOrPhone: string,
    password: string,
    context: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
  ): Promise<LoginResponse> {
    const identifier = normalizeLoginIdentifier(emailOrPhone);
    const alreadyLocked = await this.loginAttempts.isLocked(identifier);

    // Always run the same validateUser path regardless of lock state, so
    // total request timing doesn't itself reveal whether this identifier is
    // currently locked out.
    const user = await this.validateUser(emailOrPhone, password);
    const success = !!user && !alreadyLocked;

    if (!success) {
      if (!alreadyLocked) {
        const { delayMs } = await this.loginAttempts.recordFailure(identifier);
        await sleep(delayMs);
      }

      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          action: AuditAction.LOGIN_FAILED,
          entity_type: 'User',
          entity_id: user?.id ?? null,
          performed_by_user_id: user?.id ?? null,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { identifier },
        }),
      );

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginAttempts.reset(identifier);

    // Fetch all memberships for this user
    const memberships = await this.userTenantRepository.find({
      where: { user_id: user.id },
    });

    const membershipPayload: JwtMembership[] = memberships.map((m) => ({
      tenantId: m.tenant_id,
      role: m.role,
    }));

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      memberships: membershipPayload,
    };

    // Update last login timestamp
    user.last_login_at = new Date();
    await this.userRepository.save(user);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: AuditAction.LOGIN,
        entity_type: 'User',
        entity_id: user.id,
        performed_by_user_id: user.id,
        ip_address: context.ip,
        user_agent: context.userAgent,
      }),
    );

    return {
      access_token: this.jwtService.sign(payload),
      memberships: membershipPayload,
    };
  }
}
