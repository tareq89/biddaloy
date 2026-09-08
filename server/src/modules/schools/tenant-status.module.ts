import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { School } from './entities/school.entity';
import { TenantStatusService, TENANT_STATUS_REDIS } from './tenant-status.service';

/**
 * `ContextGuard` calls `TenantStatusService.isActive()` on every
 * authenticated request (#527), via `@UseGuards(ContextGuard)` on ~20
 * controllers across as many modules. Nest only resolves a guard's
 * constructor dependencies through modules the *declaring* controller's
 * module can reach — it does not matter that `ContextGuard` itself is a
 * `@Global()`-exported singleton (`AuthModule`) if one of its own
 * dependencies lives in a module none of those ~20 controllers' modules
 * import. Rather than importing `SchoolsModule` into every one of them,
 * `TenantStatusService` gets its own `@Global()` module, exactly like
 * `AccessTokenDenylistService`/`LoginAttemptService` already do by living
 * directly inside the `@Global` `AuthModule`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([School]), ConfigModule],
  providers: [
    TenantStatusService,
    {
      provide: TENANT_STATUS_REDIS,
      inject: [ConfigService],
      // Same fail-open-friendly settings as the other short-lived Redis
      // lookups in auth.module.ts (AccessTokenDenylistService,
      // LoginAttemptService) — TenantStatusService.isActive() runs on every
      // authenticated request via ContextGuard, so a disconnected/hanging
      // Redis must fail fast rather than queue or block the request.
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 1000,
        }),
    },
  ],
  // `TENANT_STATUS_REDIS` is exported too, not just `TenantStatusService` —
  // `SchoolsService` injects the raw client directly (for its own
  // suspend/reactivate invalidation), not only through `TenantStatusService`.
  exports: [TenantStatusService, TENANT_STATUS_REDIS],
})
export class TenantStatusModule {}
