import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushConfigService } from './push-config';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  providers: [PushConfigService],
  exports: [PushConfigService],
})
export class PushModule {}
