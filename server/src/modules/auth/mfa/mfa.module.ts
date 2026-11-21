import { forwardRef, Module } from '@nestjs/common';
import { SchoolsModule } from '../../schools/schools.module';
import { MfaService } from './mfa.service';

@Module({
  imports: [forwardRef(() => SchoolsModule)], // exports EncryptionService
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
