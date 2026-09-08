import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchoolsModule } from '../../schools/schools.module';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import { SmsCreditLedger } from './entities/sms-credit-ledger.entity';
import { SmsCreditService } from './sms-credit.service';

/** [15.6.3/#546] Owns `SmsCreditService`, the only writer to
 * `sms_credit_ledger`/`sms_credit_balance` (#545). `forwardRef` on
 * `SchoolsModule` mirrors `CommunicationsModule`'s own import of it —
 * `SchoolsModule` -> `AccountAccessModule` -> `CommunicationsModule` ->
 * `CreditsModule` -> `SchoolsModule` closes the same cycle one hop later,
 * so it needs the same break. */
@Module({
  imports: [
    TypeOrmModule.forFeature([SmsCreditBalance, SmsCreditLedger]),
    forwardRef(() => SchoolsModule),
  ],
  providers: [SmsCreditService],
  exports: [SmsCreditService],
})
export class CreditsModule {}
