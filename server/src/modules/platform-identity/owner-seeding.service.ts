import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { UserStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { toE164ish } from '../account-access/phone-delivery.util';
import { isDemoMode } from '../demo/demo-mode';
import { TenantStatusService } from '../schools/tenant-status.service';
import { PlatformHomeService } from './platform-home.service';

/** Arbitrary constant: two app containers booting together queue on it. */
export const OWNER_SEED_LOCK_KEY = 98_001_001;
const SLOTS = [1, 2] as const;
const MAX_OWNERS = 2;

/**
 * [Epic 98] Two platform owners always exist. Runs at boot; reads COCKPIT_OWNER_{1,2}_{EMAIL,PHONE}.
 * No message or log line ever carries an email or phone (Rule 13): only the slot name.
 */
@Injectable()
export class OwnerSeedingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OwnerSeedingService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly home: PlatformHomeService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  async seed(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (isDemoMode()) return; // the demo has no cockpit

    const slots = SLOTS.map((n) => ({
      slot: `COCKPIT_OWNER_${n}`,
      n,
      email: (env[`COCKPIT_OWNER_${n}_EMAIL`] ?? '').trim(),
      phone: (env[`COCKPIT_OWNER_${n}_PHONE`] ?? '').trim(),
    }));
    if (!slots.some((s) => s.email || s.phone)) {
      // D23: the old platform path stays alive until cutover, so an unconfigured boot (even in
      // production) must not fail. A PARTIAL config still throws below.
      const msg = 'No COCKPIT_OWNER_* set; skipping platform owner seeding';
      if (env.NODE_ENV === 'production') this.logger.warn(`${msg}; configure both owner slots`);
      else this.logger.log(msg);
      return;
    }
    for (const s of slots) {
      if (!s.email || !s.phone) throw new Error(`${s.slot} needs both an email and a phone`);
    }

    await this.ds.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock($1)`, [OWNER_SEED_LOCK_KEY]);
      const homeId = await this.home.ensure(em);
      const oldPlatformId = await this.tenantStatus.platformTenantId();
      const allowedSchools = [homeId, ...(oldPlatformId ? [oldPlatformId] : [])];

      for (const s of slots) {
        await this.seedOwner(
          em,
          s.slot,
          normalizeLoginIdentifier(s.email),
          toE164ish(s.phone),
          s.n,
          allowedSchools,
        );
      }
    });
  }

  private async seedOwner(
    em: EntityManager,
    slot: string,
    email: string,
    phone: string,
    n: number,
    allowedSchools: string[],
  ): Promise<void> {
    const conflict = () =>
      new Error(`${slot} conflicts with an existing account; resolve it before booting`);

    const byEmail = await em.findOne(User, { where: { email }, withDeleted: true });
    const byPhone = await em.findOne(User, { where: { phone }, withDeleted: true });
    if (byEmail?.deleted_at || byPhone?.deleted_at) throw conflict();
    if (byPhone && byPhone.id !== byEmail?.id) throw conflict();

    if (byEmail) {
      if (await em.exists(PlatformAdmin, { where: { user_id: byEmail.id } })) return;
      // Never promote a suspended or otherwise inactive account to owner.
      if (byEmail.status !== UserStatus.ACTIVE) throw conflict();
      // D18: a person who belongs to an ordinary school cannot be an owner.
      const outside: unknown[] = await em.query(
        `SELECT 1 FROM user_tenants WHERE user_id = $1 AND deleted_at IS NULL
           AND NOT (tenant_id = ANY($2::uuid[])) LIMIT 1`,
        [byEmail.id, allowedSchools],
      );
      if (outside.length > 0) throw conflict();
    }

    if ((await em.count(PlatformAdmin)) >= MAX_OWNERS) {
      this.logger.warn(
        `${slot} is not an existing owner; use cockpit-replace-owner to change owners`,
      );
      return;
    }

    let userId = byEmail?.id;
    if (!userId) {
      const now = new Date();
      const user = await em.save(
        em.create(User, {
          email,
          phone,
          full_name: `Platform owner ${n}`,
          status: UserStatus.ACTIVE,
          password_hash: null,
          email_verified_at: now,
          phone_verified_at: now,
        }),
      );
      userId = user.id;
    }
    await em.insert(PlatformAdmin, { user_id: userId });
  }
}
