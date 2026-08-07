import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { EncryptionService } from './settings/encryption.service';
import { buildEncryptionKey, buildPreviousEncryptionKeys } from './settings/encryption-key';

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
  imports: [TypeOrmModule.forFeature([School]), ConfigModule],
  controllers: [SchoolsController],
  providers: [
    SchoolsService,
    {
      provide: EncryptionService,
      inject: [ConfigService],
      // Eagerly instantiated as part of module setup (Nest's default —
      // this module isn't lazy-loaded), so a production boot with no
      // SETTINGS_ENCRYPTION_KEY fails right here, at startup, rather than
      // on whatever request first happens to touch a tenant secret.
      useFactory: encryptionServiceFactory,
    },
  ],
  exports: [SchoolsService, EncryptionService],
})
export class SchoolsModule {}
