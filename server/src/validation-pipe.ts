import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * The strict validation config used at boot (main.ts) and by every e2e spec,
 * so tests exercise the actual production wiring rather than a hand-copied
 * duplicate that could drift from it (see issue #43 — prod and e2e ran
 * different pipes for a long time, and only e2e whitelisted unknown fields).
 *
 * `enableImplicitConversion: false` is deliberate: implicit conversion
 * coerces `"abc"` -> `NaN` on `@IsNumber()` fields instead of rejecting the
 * request, which is a validation hole. Query/param DTOs that need string ->
 * number coercion do it explicitly via `@Type(() => Number)`.
 */
export function buildValidationPipeOptions(): ValidationPipeOptions {
  return {
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: false },
  };
}
