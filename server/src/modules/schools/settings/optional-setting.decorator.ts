import { ValidateIf } from 'class-validator';

/**
 * `@IsOptional()` for a settings field, without its `null` blind spot.
 *
 * class-validator's own `@IsOptional()` skips every subsequent validator
 * for `undefined` *and* `null`, which lets `communications.sms: null` or
 * `apiUrl: null` through untouched. Neither is a shape `TenantSettings`
 * (`shared/src/types/tenant-settings.types.ts`) permits: a section is
 * either present and well-formed or absent entirely — there is no
 * "explicitly nothing" state, and `mergeTenantSettings` has no meaning
 * for one either, since omission is already how a patch says "leave this
 * alone".
 *
 * `ValidateIf` short-circuits only on `undefined`, so `null` falls
 * through to whatever validator follows — `@IsString()`, or
 * `@NestedSettings()`'s own `@IsDefined()` — and is rejected there with a
 * real message instead of being silently persisted.
 */
export function OptionalSetting(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}
