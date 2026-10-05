import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  LoginResponse,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { isSecretEchoEnabled } from '../account-access/account-access-echo';
import { AccountAccessDeliveryService } from '../account-access/account-access-delivery.service';
import { OtpService } from '../account-access/otp.service';
import { isSmsAllowed } from '../account-access/phone-delivery.util';
import { resolveAppBaseUrl } from '../account-access/app-base-url.util';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuthResult, AuthService } from '../auth/auth.service';
import { RequestContext } from '../../common/request-context.util';
import { SocialIdentityService } from '../auth/social/social-identity.service';
import { SocialTicketService } from '../auth/social/social-ticket.service';
import { UserIdentity } from '../auth/entities/user-identity.entity';
import { ProvisioningService } from '../schools/provisioning/provisioning.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { TrialService } from '../schools/trial/trial.service';
import { User } from '../users/entities/user.entity';
import { RegisterResendDto } from './dto/register-resend.dto';
import { RegisterStartDto } from './dto/register-start.dto';
import { RegisterVerifyDto } from './dto/register-verify.dto';
import { RegistrationStagingService, StagedRegistration } from './registration-staging.service';
import { TurnstileService } from './turnstile.service';

const OTP_PURPOSE = 'REGISTER';
const RESEND_IN_SECONDS = 60;
/** One captcha buys a stage; this caps how many extra codes (SMS cost) it can send. */
const MAX_RESENDS = 3;
/** D31: SMS codes only go to numbers with an allowed prefix (default Bangladesh); others get the code by email. */
const DEFAULT_SMS_PREFIXES = '+880';

export interface RegisterStartResult {
  registration_id: string;
  channel: 'sms' | 'email';
  resend_in: number;
  debug?: { otp: string };
}

export interface RegisterVerifyResult extends LoginResponse {
  needs_password: boolean;
  password_required: boolean;
}

/** The session result plus whether a social account was linked (drives the cookie clear). */
export interface RegisterVerifyOutcome {
  auth: AuthResult;
  body: RegisterVerifyResult;
}

const contactInUse = () =>
  new ConflictException({
    message: 'This phone or email already belongs to another account',
    details: { code: 'CONTACT_IN_USE' },
  });

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // A name with no Latin letters (Bangla) has no readable base, so it gets a longer random suffix.
  return `${base || 'school'}-${randomBytes(base ? 3 : 5).toString('hex')}`;
}

/**
 * Public self-service registration [13.3.1]: details + code → a school in trial with the
 * registrant as its ADMIN and a signed-in session. Nothing is created until the code is proven.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly turnstile: TurnstileService,
    private readonly staging: RegistrationStagingService,
    private readonly otp: OtpService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly provisioning: ProvisioningService,
    private readonly trial: TrialService,
    private readonly notices: AdminNoticeService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly socialTickets: SocialTicketService,
    private readonly socialIdentity: SocialIdentityService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
  ) {}

  async start(dto: RegisterStartDto, context: RequestContext): Promise<RegisterStartResult> {
    await this.turnstile.verify(dto.captcha_token, context.ip);

    const byEmail = !isSmsAllowed(
      dto.phone,
      this.config.get<string>('OTP_SMS_ALLOWED_PREFIXES') || DEFAULT_SMS_PREFIXES,
    );
    const staged: StagedRegistration = {
      admin_name: dto.admin_name,
      school_name: dto.school_name,
      country_code: dto.country_code,
      address: dto.address,
      phone: dto.phone,
      email: dto.email,
      terms_accepted_at: new Date().toISOString(),
      identifier: byEmail ? dto.email : dto.phone,
      channel: byEmail ? 'email' : 'sms',
    };
    const registrationId = await this.staging.stage(staged);
    return this.sendCode(registrationId, staged);
  }

  async resend(dto: RegisterResendDto): Promise<RegisterStartResult> {
    this.turnstile.assertAvailable();
    const staged = await this.staging.peek(dto.registration_id);
    if (!staged) throw new GoneException('This registration has expired — start again');
    if ((staged.resends ?? 0) >= MAX_RESENDS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many codes requested — start again',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.sendCode(dto.registration_id, staged);
    await this.staging.save(dto.registration_id, { ...staged, resends: (staged.resends ?? 0) + 1 });
    return result;
  }

  async verify(
    dto: RegisterVerifyDto,
    context: RequestContext,
    socialTicketId?: string,
  ): Promise<RegisterVerifyOutcome> {
    this.turnstile.assertAvailable();
    const peeked = await this.staging.peek(dto.registration_id);
    if (!peeked) throw new GoneException('This registration has expired — start again');

    // The code is checked against what the stage says it was sent to — the caller cannot pick it.
    // Bound to this registration: a code sent for another stage on the same contact fails here.
    const verdict = await this.otp.verify(
      OTP_PURPOSE,
      peeked.identifier,
      dto.otp,
      dto.registration_id,
    );
    if (verdict === 'locked') {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: 'Retry-After: 900' },
      );
    }
    if (verdict === 'expired') throw new GoneException('The code has expired — request a new one');
    if (verdict === 'invalid') throw new BadRequestException('Invalid code');

    // Read-and-delete: of two concurrent verifies with the right code, only one gets the stage.
    const staged = await this.staging.consume(dto.registration_id);
    if (!staged) throw new GoneException('This registration has already been completed');

    return this.createSchool(dto.registration_id, staged, context, socialTicketId);
  }

  /** Request a code for a staged registration and deliver it. The reply never depends on whether the contact is known. */
  private async sendCode(
    registrationId: string,
    staged: StagedRegistration,
  ): Promise<RegisterStartResult> {
    const { code } = await this.otp.request(OTP_PURPOSE, staged.identifier, registrationId);
    await this.deliver(staged, code);
    return {
      registration_id: registrationId,
      channel: staged.channel,
      resend_in: RESEND_IN_SECONDS,
      ...(isSecretEchoEnabled(this.config) ? { debug: { otp: code } } : {}),
    };
  }

  /**
   * There is no school yet, so the code goes out through the platform school
   * (`PLATFORM_TENANT_ID`) with the normal secret-safe `communication_logs` row. In production a
   * code that cannot be sent is a 503, never a silent 202; elsewhere it stays quiet (the echo
   * flag is how tests read the code).
   */
  private async deliver(staged: StagedRegistration, code: string): Promise<void> {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const tenantId = this.config.get<string>('PLATFORM_TENANT_ID');
    let sent = false;
    if (tenantId) {
      try {
        const res = await this.delivery.deliver({
          tenantId,
          medium: staged.channel === 'email' ? CommunicationMedium.EMAIL : CommunicationMedium.SMS,
          to: staged.identifier,
          recipientName: staged.admin_name,
          kind: 'OTP',
          vars: { code },
        });
        sent = res.status === CommunicationStatus.SENT;
      } catch {
        this.logger.warn('Registration code delivery failed');
      }
    }
    if (!sent && production) {
      throw new ServiceUnavailableException({
        message: 'Registration is temporarily unavailable',
        details: { code: 'REGISTRATION_UNAVAILABLE' },
      });
    }
  }

  private async createSchool(
    registrationId: string,
    staged: StagedRegistration,
    context: RequestContext,
    socialTicketId: string | undefined,
  ): Promise<RegisterVerifyOutcome> {
    const verifiedField = staged.channel === 'sms' ? 'phone' : 'email';
    const otherField = verifiedField === 'phone' ? 'email' : 'phone';

    // Whoever holds the contact the code went to owns this registration. The OTHER contact was
    // never proven, so it may not drag in somebody else's account (that would hand out a session
    // for a user who never took part).
    const owner = await this.users.findOne({
      where: { [verifiedField]: staged[verifiedField], deleted_at: IsNull() },
    });
    const other = await this.users.findOne({
      where: { [otherField]: staged[otherField], deleted_at: IsNull() },
    });
    if (other && other.id !== owner?.id) {
      throw contactInUse();
    }
    if (owner) {
      if (owner.status !== UserStatus.ACTIVE) {
        throw new ConflictException({
          message: 'This account cannot register a school',
          details: { code: 'ACCOUNT_UNAVAILABLE' },
        });
      }
      // Deny wins (same rule as OTP sign-in): if any school of this user turns code sign-in off,
      // a code alone must not give them a session, so they sign in with their password first.
      const denied = await this.memberships
        .createQueryBuilder('m')
        .innerJoin('m.tenant', 's')
        .where('m.user_id = :id', { id: owner.id })
        .andWhere('m.deleted_at IS NULL')
        .andWhere("s.settings->'auth'->>'otpLoginEnabled' = 'false'")
        .getCount();
      if (denied > 0) {
        throw new ConflictException({
          message: 'Sign in with your password to add a school',
          details: { code: 'SIGN_IN_REQUIRED' },
        });
      }
      const openTrial = await this.memberships
        .createQueryBuilder('m')
        .innerJoin('m.tenant', 's')
        .where('m.user_id = :id', { id: owner.id })
        .andWhere('m.role = :role', { role: UserRole.ADMIN })
        .andWhere('m.deleted_at IS NULL')
        .andWhere('s.trial_ends_at > now()')
        .getCount();
      if (openTrial > 0) {
        throw new ConflictException({
          message: 'You already have a school in trial',
          details: { code: 'TRIAL_ALREADY_OPEN' },
        });
      }
    }

    // A missing/expired ticket just means no Google link: the code already proved the registrant.
    const ticket = socialTicketId ? await this.socialTickets.consume(socialTicketId) : null;

    const adminContacts = owner
      ? { [verifiedField]: staged[verifiedField] }
      : { email: staged.email, phone: staged.phone };

    const provisionOnce = () =>
      this.provisioning.provision(
        {
          name: staged.school_name,
          slug: slugFor(staged.school_name),
          admin: { name: staged.admin_name, ...adminContacts },
          idempotency_key: registrationId,
          country_code: staged.country_code,
          address: staged.address,
        },
        null,
        {
          sendInvitation: false,
          inTransaction: async (manager, result) => {
            // The contact checks above ran outside this transaction. Re-assert them against the
            // admin row provisioning actually used: a user created through the unproven contact in
            // between must never end up with this school, a Google link or a session.
            if (owner ? result.admin.user_id !== owner.id : result.admin.existed) {
              throw contactInUse();
            }
            await this.trial.startTrial(result.school.id, manager);
            const userId = result.admin.user_id;
            // Compare-and-set on the contact the code went to, same as OTP login: the stamp
            // can never land on a replacement value this caller did not prove.
            await manager.update(
              User,
              { id: userId, [verifiedField]: staged[verifiedField] },
              verifiedField === 'phone'
                ? { phone_verified_at: () => 'COALESCE(phone_verified_at, now())' }
                : { email_verified_at: () => 'COALESCE(email_verified_at, now())' },
            );
            if (ticket) {
              await this.socialIdentity.link(userId, ticket, manager, context, result.school.id);
            }
            await this.audit.record(
              {
                action: AuditAction.CREATE,
                entity_type: 'Registration',
                entity_id: result.school.id,
                tenant_id: result.school.id,
                performed_by_user_id: userId,
                ip_address: context.ip,
                user_agent: context.userAgent,
                new_values: {
                  terms_accepted_at: staged.terms_accepted_at,
                  country_code: staged.country_code,
                },
              },
              manager,
            );
          },
        },
      );

    let outcome;
    try {
      outcome = await provisionOnce();
    } catch (err) {
      // Four random hex chars can clash; one retry with a new slug is enough (the idempotency
      // reservation was released when the failed transaction rolled back).
      if (err instanceof ConflictException && /slug/i.test(err.message)) {
        outcome = await provisionOnce();
      } else if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        // A contact is already held by another user row (e.g. a soft-deleted one).
        throw contactInUse();
      } else {
        throw err;
      }
    }
    if (outcome.replayed) {
      // The same registration finished a moment ago in another request; it must not start a second session here.
      throw new ConflictException('This registration has already been completed');
    }
    const { result } = outcome;

    // After commit; a failure here never fails the registration.
    try {
      await this.notices.notifyAdmins(result.school.id, 'welcome', {
        link: `${resolveAppBaseUrl(this.config)}/login`,
      });
    } catch (error) {
      this.logger.error(
        `Welcome notice failed for school ${result.school.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const user = await this.users.findOneOrFail({ where: { id: result.admin.user_id } });
    const auth = await this.auth.startSession(user, context);
    const needsPassword = user.password_hash === null;
    // Any Google identity counts, whether linked just now or already on the account (D34).
    const hasIdentity =
      (await this.users.manager.count(UserIdentity, { where: { user_id: user.id } })) > 0;
    return {
      auth,
      body: {
        access_token: auth.access_token,
        memberships: auth.memberships,
        needs_password: needsPassword,
        // Staff accounts need a password unless a social identity is the way in (D34).
        password_required: needsPassword && !hasIdentity,
      },
    };
  }
}
