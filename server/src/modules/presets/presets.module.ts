import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { PresetsController } from './presets.controller';
import { PresetRegistryService } from './preset-registry.service';
import { PresetApplyController } from './preset-apply.controller';
import { PresetApplyService } from './preset-apply.service';
import { PresetResetService } from './preset-reset.service';
import { PlatformPresetsController } from './platform-presets.controller';
import { PresetStatusService } from './preset-status.service';

/** [35.2.1] Read side of curriculum presets: registry, preview, status. */
@Module({
  imports: [SchoolsModule, AuditModule],
  controllers: [PresetsController, PresetApplyController, PlatformPresetsController],
  providers: [PresetRegistryService, PresetStatusService, PresetApplyService, PresetResetService],
  exports: [PresetRegistryService, PresetStatusService],
})
export class PresetsModule {}
