import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrinterProfile } from '../entities/printer-profile.entity';
import { AuditModule } from '../../audit/audit.module';
import { PrintersService } from './printers.service';
import { PrintersController } from './printers.controller';

/** [32.2.x] Printer profile CRUD. Wired into PrintModule by #1144. */
@Module({
  imports: [TypeOrmModule.forFeature([PrinterProfile]), AuditModule],
  controllers: [PrintersController],
  providers: [PrintersService],
  exports: [PrintersService],
})
export class PrintersModule {}
