import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import {
  ApprovalMode,
  ApprovalScope,
  AuditAction,
  Permission,
  UserRole,
  UserStatus,
  roleHasPermission,
} from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { OtpService, OtpPurpose } from '../account-access/otp.service';
import { RequestContext } from './refresh-token.service';
import { normalizeLoginIdentifier } from './normalize-identifier';
import { redactPii } from '../../common/redact-log.util';
import { SchoolsService } from '../schools/schools.service';
import { StepUpVerifyDto, StepUpApprovalResponse } from './dto/step-up.dto';
import { isSecretEchoEnabled } from '../account-access/account-access-echo';

export const STEP_UP_REDIS = 'STEP_UP_REDIS';

/**
 * OTP purpose used for step-up verification codes. `OtpService`'s
 * `OtpPurpose` union (`account-access/otp.service.ts`) doesn't list a
 * step-up purpose yet — widening it is outside this ticket's territory
 * (`otp.service.ts` isn't one of #646's owned files). The cast is safe:
 * `OtpService` only ever uses the purpose to namespace its Redis keys, it
 * never branches on the value. TODO: once a lane owns `otp.service.ts`
 * again, add `'STEP_UP'` to `OtpPurpose` properly and drop this cast.
 */
const STEP_UP_OTP_PURPOSE = 'STEP_UP' as OtpPurpose;

const FEE_APPROVE_PERMISSION = Permission.FEE_APPROVE;

const APPROVAL_TOKEN_TTL_SECONDS = 300;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
// bcrypt.compare against a hash that never matches — same shape as
// auth.service.ts's DUMMY_PASSWORD_HASH, run for every step-up verify so a
// missing/ineligible approver takes the same ~constant time as a real one
// with a wrong password. Without this, response latency alone tells an
// attacker which identifiers are real FEE_APPROVE holders.
const DUMMY_PASSWORD_HASH = '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.';

export interface StepUpOtpRequestResult {
  debug?: { otp?: string };
}

export interface ApprovalTokenPayload {
  sub: string;
  act: string;
  tid: string;
  scope: ApprovalScope;
  jti: string;
  typ: 'approval';
}

/**
 * Whether `role` holds `FEE_APPROVE`. Wraps `roleHasPermission`.
 */
export function approverHoldsFeeApprove(role: UserRole): boolean {
  return roleHasPermission(role, FEE_APPROVE_PERMISSION);
}

/**
 * `POST /auth/step-up/otp/request` + `POST /auth/step-up` (16.2.2) — turns
 * an admin's credentials, typed on the acting user's own screen, into a
 * short-lived (300s), single-use approval token bound to the actor and a
 * gated `ApprovalScope` (16.2.3/16.2.4 consume the token; this ticket only
 * issues it).
 *
 * The approver is always resolved fresh from `identifier` — never trusted
 * from the client beyond that lookup — and must be active, in the actor's
 * own tenant, and hold `FEE_APPROVE`. The actor may verify themselves as
 * the approver (D9).
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly otpService: OtpService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
    private readonly schoolsService: SchoolsService,
    private readonly config: ConfigService,
    @Inject(STEP_UP_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Always resolves 202 — never reveals whether `identifier` matches an
   * approver in the actor's tenant, whether they hold `FEE_APPROVE`, or
   * whether they're active. Actual SMS/email delivery of the code is out
   * of this ticket's scope (no channel is wired here, same as this
   * ticket's `## Files` list not including a delivery service); tests read
   * the generated code back via the same `ACCOUNT_ACCESS_ECHO_SECRETS`
   * flag `OtpLoginService.request` uses, never enabled in production.
   */
  async requestOtp(identifier: string, actorTenantId: string): Promise<StepUpOtpRequestResult> {
    const approver = await this.findEligibleApprover(identifier, actorTenantId);
    if (!approver) return {};

    try {
      const { code } = await this.otpService.request(
        STEP_UP_OTP_PURPOSE,
        normalizeLoginIdentifier(identifier),
      );
      return isSecretEchoEnabled(this.config) ? { debug: { otp: code } } : {};
    } catch {
      // Same reasoning as OtpLoginService.request: a cooldown 429 from
      // OtpService must not leak beyond this endpoint's uniform 202.
      return {};
    }
  }

  async verify(
    dto: StepUpVerifyDto,
    actorUserId: string,
    actorTenantId: string,
    context: RequestContext,
  ): Promise<StepUpApprovalResponse> {
    const identifier = normalizeLoginIdentifier(dto.identifier);

    // Scoped by tenant: an identifier is only ever resolved within
    // actorTenantId (findEligibleApprover below), so the rate-limit key
    // must match that scope. An unscoped key let any authenticated caller
    // in ANY tenant lock a real admin's identifier for 15 minutes by
    // guessing it and failing verification a few times — this key never
    // needs eligibility to be checked first, only tenant + identifier.
    const [approverAllowed, actorAllowed] = await Promise.all([
      this.checkAndIncrementRateLimit(`step-up-attempts:approver:${actorTenantId}:${identifier}`),
      this.checkAndIncrementRateLimit(`step-up-attempts:actor:${actorUserId}`),
    ]);
    if (!approverAllowed || !actorAllowed) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: 'Retry-After: 900' },
      );
    }

    if (dto.method === 'PASSWORD') {
      const settings = await this.schoolsService.getResolvedSettings(actorTenantId);
      if (this.resolveApprovalMode(settings) !== ApprovalMode.OTP_OR_PASSWORD) {
        throw new BadRequestException('PASSWORD_NOT_ALLOWED');
      }
    }

    const approver = await this.findEligibleApprover(dto.identifier, actorTenantId);
    // Always runs the same credential check, even for a missing/ineligible
    // approver (against a dummy hash / a doomed-to-fail OTP check) — see
    // DUMMY_PASSWORD_HASH above. Using `&&` short-circuit here would skip
    // bcrypt entirely for an unknown identifier, and that latency
    // difference is itself a signal despite the uniform 401 body.
    const verified = await this.verifyCredential(dto, approver, identifier);

    if (!approver || !verified) {
      await this.auditService.record({
        action: AuditAction.LOGIN_FAILED,
        entity_type: 'ApprovalToken',
        entity_id: null,
        tenant_id: actorTenantId,
        performed_by_user_id: actorUserId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        // `identifier` run through redactPii so a raw email/phone never
        // lands in an audit row — matches db-logger.ts's use of the same
        // util for other user-supplied strings that end up persisted.
        new_values: { identifier: redactPii(identifier), method: dto.method, scope: dto.scope },
      });
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const jti = randomUUID();
    const payload: ApprovalTokenPayload = {
      sub: approver.id,
      act: actorUserId,
      tid: actorTenantId,
      scope: dto.scope,
      jti,
      typ: 'approval',
    };
    const approval_token = this.jwtService.sign(payload, { expiresIn: APPROVAL_TOKEN_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_TTL_SECONDS * 1000);

    // Single-use marker other tickets (16.2.3/16.2.4) consume-and-delete
    // when redeeming the token — this ticket only ever writes it. Fails
    // CLOSED: a token that failed to persist its single-use marker would
    // be usable an unbounded number of times, so a Redis error here must
    // surface as a controlled 503, not silently succeed with a 200 the
    // caller believes is a real, single-use approval.
    try {
      await this.redis.set(`approval:${jti}`, '1', 'PX', APPROVAL_TOKEN_TTL_SECONDS * 1000);
    } catch (error) {
      this.logger.error(
        `Failed to persist approval token marker for jti ${jti}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException('Approval token storage unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'ApprovalToken',
      entity_id: jti,
      tenant_id: actorTenantId,
      performed_by_user_id: actorUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { scope: dto.scope, approver_id: approver.id, actor_id: actorUserId },
    });

    return {
      approval_token,
      expires_at: expiresAt.toISOString(),
      approver: { id: approver.id, full_name: approver.full_name },
    };
  }

  /** Resolves an approver by identifier, scoped to the actor's tenant, active, holding FEE_APPROVE. Null on any mismatch — callers must not distinguish why. */
  private async findEligibleApprover(
    identifier: string,
    actorTenantId: string,
  ): Promise<User | null> {
    const normalized = normalizeLoginIdentifier(identifier);
    const user = await this.userRepo.findOne({
      where: [{ email: normalized }, { phone: normalized }],
    });
    if (!user || user.status !== UserStatus.ACTIVE) return null;

    const membership = await this.userTenantRepo.findOne({
      where: { user_id: user.id, tenant_id: actorTenantId },
    });
    if (!membership || !approverHoldsFeeApprove(membership.role)) return null;

    return user;
  }

  /** `approver` is `null` for an unknown/ineligible identifier — this still
   * runs a real OTP lookup or bcrypt.compare against a dummy hash so the
   * response time doesn't itself reveal whether the identifier resolved. */
  private async verifyCredential(
    dto: StepUpVerifyDto,
    approver: User | null,
    normalizedIdentifier: string,
  ): Promise<boolean> {
    if (dto.method === 'OTP') {
      if (!dto.otp) return false;
      const result = await this.otpService.verify(
        STEP_UP_OTP_PURPOSE,
        normalizedIdentifier,
        dto.otp,
      );
      return approver !== null && result === 'ok';
    }

    if (!dto.password) return false;
    const hashToCompare = approver?.password_hash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);
    return approver !== null && !!approver.password_hash && isPasswordValid;
  }

  /** Reads `settings.fees.approval_mode` defensively — the `fees` key isn't
   * on `TenantSettings` yet in this worktree (#645, running in parallel,
   * adds it); `shared/src/types/tenant-settings.types.ts` is outside this
   * ticket's territory. Defaults to `OTP` (the stricter mode) when unset,
   * matching "a school opts in to the weaker path, not out of it". */
  private resolveApprovalMode(settings: unknown): ApprovalMode {
    const raw = (settings as { fees?: { approval_mode?: string } } | null)?.fees?.approval_mode;
    return raw === ApprovalMode.OTP_OR_PASSWORD ? ApprovalMode.OTP_OR_PASSWORD : ApprovalMode.OTP;
  }

  /** Fails CLOSED on a Redis error — this is the brute-force gate in front
   * of admin-approval issuance, so an outage must not silently disable it
   * (same call OtpService itself makes, unlike LoginAttemptService's
   * fail-open, which only protects ordinary login). */
  private async checkAndIncrementRateLimit(key: string): Promise<boolean> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
      }
      return count <= RATE_LIMIT_MAX_ATTEMPTS;
    } catch (error) {
      this.logger.error(
        `Step-up rate-limit check failed for key, failing closed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
