import { IsIn, IsObject, IsOptional } from 'class-validator';
import {
  TESTABLE_MEDIA,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';

/**
 * Body for `POST /schools/:id/settings/test` (#8.7.12). `config` is
 * intentionally loose (`Record<string, unknown>`, not one of the 4
 * medium-specific settings DTOs) — it's never persisted, only passed
 * straight through to `TenantProviderConfigResolver`'s per-medium
 * `override` parameter, which reads only the fields it recognizes and
 * ignores the rest. A stricter per-medium shape would need a
 * discriminated union keyed on `medium`, which class-validator doesn't
 * support cleanly; the fields that matter are still type-checked at the
 * resolver, just one layer in rather than at the HTTP boundary.
 */
export class TestConnectionDto {
  @IsIn(TESTABLE_MEDIA)
  medium: TestableCommunicationMedium;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
