import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DemoController } from './demo.controller';
import { DemoModeGuard } from './demo-mode.guard';

/**
 * Public-demo guards. Every piece checks `DEMO_MODE` itself and does nothing when it is unset.
 * The "is this a demo database" check is not here: it must run before Nest boots
 * (`assertDemoDatabase` in `demo-boot-check.ts`).
 */
@Module({
  controllers: [DemoController],
  providers: [{ provide: APP_GUARD, useClass: DemoModeGuard }],
})
export class DemoModule {}
