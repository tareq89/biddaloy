import { Module } from '@nestjs/common';
import { PrintTemplatesModule } from './templates/print-templates.module';
import { PrintAssetsModule } from './assets/print-assets.module';
import { PrintersModule } from './printers/printers.module';
import { PrintJobsModule } from './jobs/print-jobs.module';

/** [32.2.9] Every printing route lives behind this one module (D55). */
@Module({
  imports: [PrintTemplatesModule, PrintAssetsModule, PrintersModule, PrintJobsModule],
})
export class PrintModule {}
