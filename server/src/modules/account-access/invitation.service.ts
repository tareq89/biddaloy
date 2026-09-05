import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuditAction, AuthTokenPurpose, InvitationStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { AuthTokenService, INVITE_TTL_MS } from './auth-token.service';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';
import { deriveInvitationStatus } from './invitation-status.util';
import { isSecretEchoEnabled } from './account-access-echo';

export interface IssueAndSendInput {
  userId: string;
  tenantId: string;
  // `null` for a self-service reissue (`ActivationService.resend`, 12.2) —
  // no admin actor performed it, the invitee triggered it themselves.
  actorUserId: string | null;
}

export interface IssueAndSendResult {
  status: string;
  medium: string;
  expires_at: Date;
  debug?: { token: string };
}

const DEFAULT_APP_BASE_URL = 'http://localhost:5174';

@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly authTokens: AuthTokenService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private async loadMember(userId: string, tenantId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId, deleted_at: IsNull() } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    const membership = await this.userTenantRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId },
    });
    if (!membership) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return user;
  }

  private appBaseUrl(): string {
    const configured = this.config.get<string>('APP_BASE_URL');
    if (configured) return configured;
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('APP_BASE_URL must be set in production to build invitation/reset links.');
    }
    return DEFAULT_APP_BASE_URL;
  }

  async issueAndSend(input: IssueAndSendInput): Promise<IssueAndSendResult> {
    const user = await this.loadMember(input.userId, input.tenantId);
    if (user.password_hash) {
      throw new ConflictException('User already has a password');
    }

    const channel = pickChannel(user);
    if (!channel) {
      throw new BadRequestException('User has no email or phone to send an invitation to');
    }

    const { raw } = await this.authTokens.issue({
      userId: user.id,
      tenantId: input.tenantId,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: INVITE_TTL_MS,
      createdByUserId: input.actorUserId,
    });

    const link = `${this.appBaseUrl()}/activate?token=${raw}`;
    const { logId, status } = await this.delivery.deliver({
      tenantId: input.tenantId,
      medium: channel.medium,
      to: channel.to,
      recipientName: user.full_name,
      kind: 'INVITATION',
      vars: { link },
    });

    await this.audit.record({
      action: AuditAction.INVITATION_SENT,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: input.tenantId,
      performed_by_user_id: input.actorUserId,
      new_values: { medium: channel.medium, log_id: logId },
    });

    const echo = isSecretEchoEnabled(this.config);
    return {
      status,
      medium: channel.medium,
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
      ...(echo ? { debug: { token: raw } } : {}),
    };
  }

  async revoke(input: { userId: string; tenantId: string; actorUserId: string }): Promise<void> {
    await this.loadMember(input.userId, input.tenantId);
    await this.authTokens.revokeLive(input.userId, AuthTokenPurpose.INVITE);
    await this.audit.record({
      action: AuditAction.INVITATION_REVOKED,
      entity_type: 'User',
      entity_id: input.userId,
      tenant_id: input.tenantId,
      performed_by_user_id: input.actorUserId,
    });
  }

  async statusFor(user: Pick<User, 'id' | 'password_hash'>): Promise<InvitationStatus> {
    const latest = await this.authTokens.latest(user.id, AuthTokenPurpose.INVITE);
    return deriveInvitationStatus(user, latest);
  }
}
