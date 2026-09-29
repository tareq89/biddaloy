import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { StorageModule } from '../../storage/storage.module';
import { PrintAsset } from '../entities/print-asset.entity';
import { PrintTemplate } from '../entities/print-template.entity';
import { PrintTemplateVersion } from '../entities/print-template-version.entity';
import { PrintTemplatesController } from './print-templates.controller';
import { PrintTemplatesService } from './print-templates.service';

/** [32.2.1] Template CRUD / publish / default / archive. Wired into PrintModule by a later ticket. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PrintTemplate, PrintTemplateVersion, PrintAsset]),
    StorageModule,
    AuditModule,
  ],
  controllers: [PrintTemplatesController],
  providers: [PrintTemplatesService],
  exports: [PrintTemplatesService],
})
export class PrintTemplatesModule {}
