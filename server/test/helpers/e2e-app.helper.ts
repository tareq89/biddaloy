import { INestApplication } from '@nestjs/common';
import { buildVersioningOptions } from '../../src/api-versioning';

export const API_V1 = '/api/v1';

/**
 * Applies the same global prefix + URI versioning main.ts's bootstrap()
 * sets — bootstrap() never runs under the Nest testing harness, so each
 * e2e spec must opt in explicitly. Call right after createNestApplication().
 */
export function configureApiVersioning(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning(buildVersioningOptions());
}
