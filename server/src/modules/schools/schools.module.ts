import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { EncryptionService } from './settings/encryption.service';
import { buildEncryptionKey, buildPreviousEncryptionKeys } from './settings/encryption-key';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { TenantStatusModule } from './tenant-status.module';
import { AuditModule } from '../audit/audit.module';
import { ProvisioningService } from './provisioning/provisioning.service';
import { ProvisioningController } from './provisioning/provisioning.controller';
import { SchoolAdminsService } from './admins/school-admins.service';
import { SchoolAdminsController } from './admins/school-admins.controller';
import { AccountAccessModule } from '../account-access/account-access.module';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuthToken } from '../account-access/entities/auth-token.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SchoolProfileController } from './profile/profile.controller';
import { SchoolProfileService } from './profile/profile.service';
import { SchoolLogoController } from './profile/logo.controller';
import { SchoolLogoService } from './profile/logo.service';
import { StorageModule } from '../storage/storage.module';

const TENANT_SETTINGS_CACHE_TTL_MS = 30_000;

/** The `EncryptionService` provider's `useFactory`, pulled out and exported
 * so `schools.module.spec.ts` can exercise this exact wiring — every other
 * spec in this module builds `new EncryptionService(randomBytes(32))`
 * directly, which bypasses `buildEncryptionKey`'s "no key outside
 * production" behaviour entirely. */
export function encryptionServiceFactory(config: ConfigService): EncryptionService {
  const currentKey = buildEncryptionKey(
    config.get<string>('NODE_ENV'),
    config.get<string>('SETTINGS_ENCRYPTION_KEY'),
  );
  const previousKeys = buildPreviousEncryptionKeys(
    config.get<string>('SETTINGS_ENCRYPTION_KEY_PREVIOUS'),
  );
  return new EncryptionService(currentKey, previousKeys);
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      School,
      UserTenant,
      Student,
      CommunicationLog,
      AuditLog,
      User,
      AuthToken,
    ]),
    ConfigModule,
    AuditModule,
    StorageModule,
    TenantStatusModule,
    // Circular: AccountAccessModule imports SchoolsModule (for
    // SchoolsService's tenant-settings lookups) — forwardRef breaks the
    // cycle so ProvisioningService can reuse AccountAccessDeliveryService
    // rather than re-implementing invitation delivery here (#529).
    forwardRef(() => AccountAccessModule),
  ],
  controllers: [
    SchoolsController,
    ProvisioningController,
    SchoolAdminsController,
    SchoolProfileController,
    SchoolLogoController,
  ],
  providers: [
    SchoolsService,
    ProvisioningService,
    SchoolAdminsService,
    SchoolProfileService,
    SchoolLogoService,
    {
      provide: EncryptionService,
      inject: [ConfigService],
      // Eagerly instantiated as part of module setup (Nest's default —
      // this module isn't lazy-loaded), so a production boot with no
      // SETTINGS_ENCRYPTION_KEY fails right here, at startup, rather than
      // on whatever request first happens to touch a tenant secret.
      useFactory: encryptionServiceFactory,
    },
    {
      provide: TenantSettingsCache,
      // A `useFactory` with no `inject` — Nest's constructor injection has
      // no provider for a bare `number`, so `new TenantSettingsCache(...)`
      // has to be called explicitly rather than left to `providers:
      // [TenantSettingsCache]`'s default `new TenantSettingsCache()`
      // (which would fail to resolve `ttlMs` at boot).
      useFactory: () => new TenantSettingsCache(TENANT_SETTINGS_CACHE_TTL_MS),
    },
  ],
  // TenantSettingsCache is exported so #8.7.10's TenantProviderConfigResolver
  // (in CommunicationsModule) can share the exact same cache instance
  // SchoolsService invalidates on write — a second, module-local instance
  // would never see that invalidation and could serve stale credentials
  // past a rotation.
  //
  // TenantStatusService (SchoolsService's own dependency, injected via
  // `TenantStatusModule`'s `@Global()` export — see that module's file
  // comment) is not re-declared or re-exported here.
  exports: [SchoolsService, EncryptionService, TenantSettingsCache],
})
export class SchoolsModule {}
