import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { EncryptionService } from './settings/encryption.service';
import { buildEncryptionKey, buildPreviousEncryptionKeys } from './settings/encryption-key';

@Module({
  imports: [TypeOrmModule.forFeature([School]), ConfigModule],
  providers: [
    SchoolsService,
    {
      provide: EncryptionService,
      inject: [ConfigService],
      // Eagerly instantiated as part of module setup (Nest's default —
      // this module isn't lazy-loaded), so a production boot with no
      // SETTINGS_ENCRYPTION_KEY fails right here, at startup, rather than
      // on whatever request first happens to touch a tenant secret.
      useFactory: (config: ConfigService) => {
        const currentKey = buildEncryptionKey(
          config.get<string>('NODE_ENV'),
          config.get<string>('SETTINGS_ENCRYPTION_KEY'),
        );
        const previousKeys = buildPreviousEncryptionKeys(
          config.get<string>('SETTINGS_ENCRYPTION_KEY_PREVIOUS'),
        );
        return new EncryptionService(currentKey, previousKeys);
      },
    },
  ],
  exports: [SchoolsService, EncryptionService],
})
export class SchoolsModule {}
