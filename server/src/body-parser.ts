import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Express's default JSON body limit is 100 kB. A month save on
 * `PUT /attendance/sections/:id/register-matrix` (up to 31 days x a 50+
 * student section) is ~115-140 kB, so the API takes up to 1 MB. nginx in
 * front allows 10 MB (`client_max_body_size` in
 * nginx/templates/default.conf.template), so this is the tighter bound.
 */
export const JSON_BODY_LIMIT = '1mb';

/** Call before `app.init()` / `listen()` — main.ts and any e2e app that needs
 * the real limit. Nest then skips registering its own default JSON parser. */
export function configureBodyParser(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
