import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ImportStagingService, BULK_IMPORT_REDIS } from './import-staging.service';

// @Global() mirrors AuthModule — every later 14.3 lane (workbook parsing,
// student import, etc.) needs ImportStagingService and this spares each of
// them an explicit import line.
@Global()
@Module({
  providers: [
    {
      provide: BULK_IMPORT_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          // Staging calls are user-initiated request/response (stage on
          // upload, peek/consume on commit) — a hung connection must fail
          // fast rather than hold the HTTP request open indefinitely.
          commandTimeout: 1000,
        }),
    },
    ImportStagingService,
  ],
  exports: [ImportStagingService],
})
export class BulkImportModule {}
