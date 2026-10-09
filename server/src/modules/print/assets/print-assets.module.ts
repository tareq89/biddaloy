import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintAsset } from '../entities/print-asset.entity';
import { AuditModule } from '../../audit/audit.module';
import { StorageModule } from '../../storage/storage.module';
import { PrintAssetsController } from './print-assets.controller';
import { PrintAssetsService } from './print-assets.service';

/** [32.2.2] Self-contained; registered in the app by the print module wiring (32.2.x). */
@Module({
  imports: [TypeOrmModule.forFeature([PrintAsset]), AuditModule, StorageModule],
  controllers: [PrintAssetsController],
  providers: [PrintAssetsService],
  exports: [PrintAssetsService],
})
export class PrintAssetsModule {}
