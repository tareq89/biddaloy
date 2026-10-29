import { UnprocessableEntityException } from '@nestjs/common';
import { isDemoMode } from './demo-mode';

export const DEMO_ROW_LIMIT = 100;

/**
 * In the public demo a bulk request above 100 rows is refused whole, before any
 * write (Epic 88 U8/D10). A no-op everywhere else. The message is fixed and
 * never echoes file content (Rule 23); `count` is a number, not input text.
 */
export function assertDemoRowLimit(count: number): void {
  if (!isDemoMode() || count <= DEMO_ROW_LIMIT) return;
  throw new UnprocessableEntityException({
    message: 'Demo: at most 100 rows per request',
    details: { code: 'DEMO_ROW_LIMIT', limit: DEMO_ROW_LIMIT, count },
  });
}
