import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { LegalAcceptance } from './entities/legal-acceptance.entity';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/** [59.2.01] Legal document acceptance. Reached through RegistrationModule (59.2.04 owns app.module). */
@Module({
  imports: [TypeOrmModule.forFeature([LegalAcceptance]), AuditModule],
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
