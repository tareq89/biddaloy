import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
  // No AuditModule import: it pulls controllers, DashboardModule and guards into every module (and
  // integration spec) that stores a file, and a second AuditService instance breaks specs that spy on
  // the app's one. VirusScanService needs AuditService only on the refusal path, so it looks it up then.
  providers: [
    {
      provide: VirusScanService,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef) =>
        new VirusScanService({
          record: (...args: Parameters<AuditService['record']>) =>
            ref.get(AuditService, { strict: false }).record(...args),
        } as AuditService),
    },
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
