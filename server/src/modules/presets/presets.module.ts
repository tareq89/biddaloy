import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { PlatformSetting } from '../platform-identity/entities/platform-setting.entity';
import { PlatformModulesController } from './platform-modules.controller';
import { PlatformModulesService } from './platform-modules.service';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { SchoolsModule } from '../schools/schools.module';
import { PresetsController } from './presets.controller';
import { PresetRegistryService } from './preset-registry.service';
import { PresetApplyController } from './preset-apply.controller';
import { PresetApplyService } from './preset-apply.service';
import { PresetResetService } from './preset-reset.service';
import { PlatformPresetsController } from './platform-presets.controller';
import { PresetStatusService } from './preset-status.service';
import { InstitutionKindController } from './institution-kind.controller';
import { InstitutionKindService } from './institution-kind.service';

/** [35.2.1] Read side of curriculum presets: registry, preview, status. */
@Module({
  imports: [
    SchoolsModule,
    AuditModule,
    StorageModule,
    PlatformIdentityModule,
    TypeOrmModule.forFeature([PlatformSetting]),
  ],
  controllers: [
    PresetsController,
    PresetApplyController,
    PlatformPresetsController,
    InstitutionKindController,
    PlatformModulesController,
  ],
  providers: [
    PresetRegistryService,
    PresetStatusService,
    PresetApplyService,
    PresetResetService,
    InstitutionKindService,
    PlatformModulesService,
  ],
  exports: [PresetRegistryService, PresetStatusService],
})
export class PresetsModule {}
