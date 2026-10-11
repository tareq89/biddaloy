import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_TRIAL_EXPIRED_KEY = 'allowWhenTrialExpired';

/**
 * D16: a school whose trial ended (SUSPENDED + TRIAL_EXPIRED) may still take a
 * copy of its data. ContextGuard lets a marked route through for that
 * suspension only; any other suspension reason stays fully blocked.
 *
 * Method-level only: ContextGuard reads the handler, not the class, so a class-level
 * mark cannot open the other routes in that controller (restore, pin).
 *
 * Use ONLY on the backup export / poll / download routes. When #1788 (63.2,
 * read-only status) lands, its allowlist should reuse this marker rather than
 * add a second list.
 */
export const AllowWhenTrialExpired = () => SetMetadata(ALLOW_WHEN_TRIAL_EXPIRED_KEY, true);
