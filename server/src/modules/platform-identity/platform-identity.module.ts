import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformHomeService } from './platform-home.service';
import { OwnerSeedingService } from './owner-seeding.service';

/**
 * [Epic 98] Platform owners, their guard, the platform home school, boot-time owner seeding.
 * `TenantStatusService` comes from the global `TenantStatusModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlatformAdmin])],
  providers: [PlatformAdminGuard, PlatformAdminService, PlatformHomeService, OwnerSeedingService],
  exports: [PlatformAdminGuard, PlatformAdminService, PlatformHomeService, OwnerSeedingService],
})
export class PlatformIdentityModule {}
