import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

/** Read by `AppModule`'s `BullModule.forRootAsync` (`extraOptions.manualRegistration`). */
export const QUEUE_WORKERS_DISABLED_ENV = 'QUEUE_WORKERS_DISABLED';

/**
 * Boots `AppModule` for a one-off script (seed, re-encrypt) WITHOUT starting
 * its BullMQ workers. A script only wants the services and the DataSource;
 * running workers would pull real jobs off Redis — which in dev is shared
 * with other databases (e2e, test), so the script ended up processing other
 * environments' jobs ("backup schedule job failed ... School not found").
 *
 * The flag is read when `app.module.ts` is first evaluated, so it must be
 * set before that import — hence the dynamic `import()` below instead of a
 * top-of-file `import { AppModule }`.
 */
export async function createScriptAppContext(): Promise<INestApplicationContext> {
  process.env[QUEUE_WORKERS_DISABLED_ENV] = 'true';
  const { AppModule } = await import('../app.module');
  return NestFactory.createApplicationContext(AppModule);
}
