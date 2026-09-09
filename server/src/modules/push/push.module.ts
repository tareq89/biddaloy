import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushConfigService } from './push-config';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushService } from './push.service';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  controllers: [PushSubscriptionsController],
  providers: [PushConfigService, PushSubscriptionsService, PushService],
  exports: [PushConfigService, PushService],
})
export class PushModule {}
