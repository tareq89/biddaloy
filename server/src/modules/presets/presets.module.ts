import { Module } from '@nestjs/common';
import { SchoolsModule } from '../schools/schools.module';
import { PresetsController } from './presets.controller';
import { PresetRegistryService } from './preset-registry.service';
import { PresetStatusService } from './preset-status.service';

/** [35.2.1] Read side of curriculum presets: registry, preview, status. */
@Module({
  imports: [SchoolsModule],
  controllers: [PresetsController],
  providers: [PresetRegistryService, PresetStatusService],
  exports: [PresetRegistryService, PresetStatusService],
})
export class PresetsModule {}
