import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DemoBootGuard } from './demo-boot.guard';
import { DemoController } from './demo.controller';
import { DemoModeGuard } from './demo-mode.guard';

/** Public-demo guards. Every piece checks `DEMO_MODE` itself and does nothing when it is unset. */
@Module({
  controllers: [DemoController],
  providers: [DemoBootGuard, { provide: APP_GUARD, useClass: DemoModeGuard }],
})
export class DemoModule {}
