import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_READ_ONLY_KEY = 'allowWhenReadOnly';

/**
 * Epic 49 D9: a school over its seats is read-only, but a user's own, non-school writes stay
 * open (mark an alert seen, step up, push subscriptions, own preferences). ContextGuard skips
 * the TENANT_READ_ONLY check for a marked handler. It does NOT open a suspended school.
 *
 * Method-level only (ContextGuard reads the handler). The allowlist is pinned by
 * `allow-when-suspended-for-billing.decorator.spec.ts`; listed in
 * docs/architecture/22-onboarding.md, "Writes that stay open".
 */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_WHEN_READ_ONLY_KEY, true);
