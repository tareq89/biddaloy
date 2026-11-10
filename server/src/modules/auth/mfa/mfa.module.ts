import { Module } from '@nestjs/common';
import { SchoolsModule } from '../../schools/schools.module';
import { MfaService } from './mfa.service';

@Module({
  imports: [SchoolsModule], // exports EncryptionService
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
