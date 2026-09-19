import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { CalendarFeedToken } from './entities/calendar-feed-token.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { AcademicTerm } from './entities/academic-term.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CalendarViewer, visibilityWhere } from './calendar-visibility.util';
import { CalendarEventsService } from './calendar-events.service';
import { SchoolsService } from '../schools/schools.service';
import { AuditService } from '../audit/audit.service';
import { buildIcsCalendar, IcsEventInput } from './ics/ics-write.util';
import { CalendarFeedDto } from './dto/calendar-feed.dto';

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

/** Same "required + HTTPS-only in production" shape as
 * `resolveAppBaseUrl`/`resolvePublicAppUrl` — this feed URL is opened
 * directly by a phone calendar app against *this* server (not a client
 * SPA), so it needs this server's own public origin. */
function resolveApiBaseUrl(config: ConfigService): string {
  const configured = config.get<string>('API_BASE_URL');
  if (configured) return configured;
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('API_BASE_URL must be set in production to build calendar feed links.');
  }
  return DEFAULT_API_BASE_URL;
}

/**
 * The issue body specs "32 random bytes, store SHA-256 only" — but the
 * authenticated `GET /calendar/feed` must also be able to return the
 * *same* URL on every call while a token is still active (it's a read,
 * not a mint), and a one-way hash alone can't be turned back into the
 * URL it came from. Resolved here by deriving the raw token
 * deterministically from the token row's own id via HMAC-SHA256 keyed on
 * `JWT_SECRET`, instead of from `crypto.randomBytes`: same 32
 * cryptographically-strong bytes' worth of unguessability (HMAC output),
 * but recomputable from `(secret, row.id)` alone, so no plaintext ever
 * needs to be persisted and the stored `token_hash` (`SHA-256` of the
 * derived token) still matches the issue body's storage shape exactly.
 */
function deriveRawToken(tokenId: string, secret: string): string {
  // Domain-separated from any other HMAC use of this secret, so a token
  // for one purpose can never collide with or be confused for another's.
  return createHmac('sha256', secret).update(`calendar-feed:${tokenId}`).digest('base64url');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface CalendarFeedResolved {
  body: string;
  etag: string;
}

/** Lower bound of the feed window: 90 days before today. Kept narrow so
 * the feed stays a reasonable size and a calendar app's periodic refresh
 * doesn't re-download years of history every poll. */
const FEED_PAST_DAYS = 90;
/** Upper bound: 400 days ahead — enough to cover a full academic year plus
 * slack, same ceiling `CalendarEventsService`'s own list query uses. */
const FEED_FUTURE_DAYS = 400;

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * [17.4.1] Issues/revokes `CalendarFeedToken`s and renders the ICS feed
 * body for a token. Split into "authenticated management" (issue,
 * regenerate — scoped to the caller's own token) and "public render"
 * (looked up purely by the token's hash, no tenant/auth context at all).
 */
@Injectable()
export class CalendarFeedService {
  constructor(
    @InjectRepository(CalendarFeedToken)
    private readonly tokenRepo: Repository<CalendarFeedToken>,
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(AcademicTerm)
    private readonly termRepo: Repository<AcademicTerm>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly calendarEventsService: CalendarEventsService,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  // -----------------------------------------------------------------
  // Authenticated: issue / regenerate
  // -----------------------------------------------------------------

  /** Returns the caller's active feed token, minting one on first call
   * (D13: at most one active token per `(tenant_id, user_id)`). */
  async getOrCreate(tenantId: string, userId: string): Promise<CalendarFeedDto> {
    const existing = await this.tokenRepo.findOne({
      where: { tenant_id: tenantId, user_id: userId, revoked_at: IsNull() },
    });
    if (existing) {
      const rawToken = deriveRawToken(existing.id, this.requireSecret());
      return { url: this.urlFor(rawToken), created_at: existing.created_at.toISOString() };
    }
    return this.mint(tenantId, userId);
  }

  /** Revokes the caller's active token (if any) and issues a fresh one —
   * the only way to cut off a leaked feed URL (D13). */
  async regenerate(tenantId: string, userId: string): Promise<CalendarFeedDto> {
    const existing = await this.tokenRepo.findOne({
      where: { tenant_id: tenantId, user_id: userId, revoked_at: IsNull() },
    });
    return this.mintReplacing(tenantId, userId, existing);
  }

  private async mintReplacing(
    tenantId: string,
    userId: string,
    existing: CalendarFeedToken | null,
  ): Promise<CalendarFeedDto> {
    if (existing) {
      existing.revoked_at = new Date();
      await this.tokenRepo.save(existing);
      await this.auditService.record({
        action: AuditAction.DELETE,
        entity_type: 'CalendarFeedToken',
        entity_id: existing.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
      });
    }
    return this.mint(tenantId, userId);
  }

  private async mint(tenantId: string, userId: string): Promise<CalendarFeedDto> {
    // `id` is generated client-side (not left to Postgres's `uuid`
    // default) so the raw token — derived from this id — is known
    // before the row is ever written, letting a single `save()` persist
    // both the row and its correct `token_hash` together.
    const id = randomUUID();
    const rawToken = deriveRawToken(id, this.requireSecret());
    let saved: CalendarFeedToken;
    try {
      saved = await this.tokenRepo.save(
        this.tokenRepo.create({
          id,
          tenant_id: tenantId,
          user_id: userId,
          token_hash: hashToken(rawToken),
        }),
      );
    } catch (err) {
      // Two concurrent `getOrCreate`/`regenerate` calls for the same
      // `(tenant_id, user_id)` can both pass the "no active token" check
      // above and both try to insert here — the partial unique index on
      // `(tenant_id, user_id) WHERE revoked_at IS NULL` lets only one
      // succeed. Rather than surface that as a 500, fall back to
      // whichever row actually won the race.
      if (this.isUniqueViolation(err)) {
        const winner = await this.tokenRepo.findOne({
          where: { tenant_id: tenantId, user_id: userId, revoked_at: IsNull() },
        });
        if (winner) {
          const winnerRawToken = deriveRawToken(winner.id, this.requireSecret());
          return {
            url: this.urlFor(winnerRawToken),
            created_at: winner.created_at.toISOString(),
          };
        }
      }
      throw err;
    }

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'CalendarFeedToken',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
    });

    return { url: this.urlFor(rawToken), created_at: saved.created_at.toISOString() };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505'
    );
  }

  private urlFor(rawToken: string): string {
    return `${resolveApiBaseUrl(this.config)}/calendar/feed/${rawToken}.ics`;
  }

  /**
   * `SETTINGS_ENCRYPTION_KEY` when set, else `JWT_SECRET` — deliberately
   * *not* hardcoded to `JWT_SECRET` alone: reviewer flagged that a leaked
   * `JWT_SECRET` would otherwise also let an attacker recompute every
   * user's feed token from its row id, and that rotating `JWT_SECRET`
   * (an auth-session concern) would silently break every subscribed
   * calendar link. Preferring the settings-encryption key decouples feed
   * tokens from JWT session rotation; `JWT_SECRET` remains the fallback
   * so this doesn't require a new required env var in every deployment.
   */
  private requireSecret(): string {
    const secret =
      this.config.get<string>('SETTINGS_ENCRYPTION_KEY') ?? this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET must be set to derive calendar feed tokens.');
    }
    return secret;
  }

  // -----------------------------------------------------------------
  // Public: render
  // -----------------------------------------------------------------

  /**
   * Renders the ICS body for a public feed request. `rawToken` is the
   * plaintext embedded in the subscribed URL — hashed here and matched
   * against `token_hash`, never trusted or decoded otherwise. Throws
   * `NotFoundException` for any of "no such token", "revoked", or "user
   * no longer active" — all three surface as an identical 404 to the
   * caller, so a scan can't distinguish a dead token from a live one
   * belonging to a deactivated user.
   */
  async render(rawToken: string): Promise<CalendarFeedResolved> {
    const tokenHash = hashToken(rawToken);
    const token = await this.tokenRepo.findOne({
      where: { token_hash: tokenHash, revoked_at: IsNull() },
    });
    if (!token) {
      throw new NotFoundException('Feed not found or no longer active');
    }

    const user = await this.userRepo.findOne({
      where: { id: token.user_id, deleted_at: IsNull() },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Feed not found or no longer active');
    }

    const membership = await this.userTenantRepo.findOne({
      where: { tenant_id: token.tenant_id, user_id: token.user_id },
    });
    if (!membership) {
      throw new NotFoundException('Feed not found or no longer active');
    }

    const school = await this.schoolRepo.findOne({
      where: { id: token.tenant_id, deleted_at: IsNull() },
    });
    if (!school || school.status !== 'ACTIVE') {
      throw new NotFoundException('Feed not found or no longer active');
    }

    const settings = await this.schoolsService.getResolvedSettings(token.tenant_id);
    const timezone = settings.region?.timezone ?? 'UTC';
    const today = new Date().toISOString().slice(0, 10);
    const from = addDaysIso(today, -FEED_PAST_DAYS);
    const to = addDaysIso(today, FEED_FUTURE_DAYS);

    const viewer: CalendarViewer = await this.calendarEventsService.resolveViewer(
      membership.role,
      token.user_id,
      token.tenant_id,
    );

    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId: token.tenant_id })
      .andWhere('event.deleted_at IS NULL')
      .andWhere('event.published_at IS NOT NULL')
      .andWhere('event.end_date >= :from', { from })
      .andWhere('event.start_date <= :to', { to });
    visibilityWhere(qb, viewer);
    const events = await qb.orderBy('event.start_date', 'ASC').getMany();

    const terms = await this.termRepo
      .createQueryBuilder('term')
      .where('term.tenant_id = :tenantId', { tenantId: token.tenant_id })
      .andWhere('term.deleted_at IS NULL')
      .andWhere('term.end_date >= :from', { from })
      .andWhere('term.start_date <= :to', { to })
      .orderBy('term.start_date', 'ASC')
      .getMany();

    const icsEvents: IcsEventInput[] = [
      ...events.map((event): IcsEventInput => ({
        id: event.id,
        name: event.name,
        description: event.description,
        startDate: event.start_date,
        endDate: event.end_date,
        startTime: event.start_time,
        endTime: event.end_time,
        timezone,
        sequence: Math.floor(event.updated_at.getTime() / 1000),
        category: event.type,
      })),
      ...terms.map((term): IcsEventInput => ({
        id: term.id,
        name: term.name,
        startDate: term.start_date,
        endDate: term.end_date,
        startTime: null,
        endTime: null,
        timezone,
        sequence: Math.floor(term.updated_at.getTime() / 1000),
        category: 'TERM',
      })),
    ];

    const body = buildIcsCalendar({
      calendarName: school.name,
      events: icsEvents,
    });
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;

    return { body, etag };
  }
}
