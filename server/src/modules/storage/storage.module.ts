import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { VirusScanService } from './virus-scan.service';
import { StorageService, buildStorageConfig } from './storage.service';

/** The `StorageService` provider's `useFactory`, pulled out and exported so
 * `storage.module.spec.ts` can exercise this exact wiring. Reads directly
 * from `process.env` (like `main.ts`'s other boot-time env checks) rather
 * than `ConfigService`, since `buildStorageConfig` needs the raw
 * `NodeJS.ProcessEnv` shape to check all five vars at once. */
export function storageServiceFactory(): StorageService {
  const storageConfig = buildStorageConfig(process.env);
  return new StorageService(storageConfig);
}

@Module({
  // AuditService is stateless (one repository). It is provided here, not via AuditModule, because
  // AuditModule pulls in controllers, DashboardModule and the guards, and every module that stores a
  // file imports StorageModule (VirusScanService writes the refusal audit row).
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [
    AuditService,
    VirusScanService,
    {
      provide: StorageService,
      // Eagerly instantiated as part of module setup — a boot with a
      // missing S3_* env var fails right here, not on whatever request
      // first happens to touch storage.
      useFactory: storageServiceFactory,
    },
  ],
  exports: [StorageService, VirusScanService],
})
export class StorageModule {}
