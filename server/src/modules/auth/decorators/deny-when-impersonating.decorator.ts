import { SetMetadata } from '@nestjs/common';

export const DENY_WHEN_IMPERSONATING_KEY = 'denyWhenImpersonating';

export interface DenyWhenImpersonatingOptions {
  /** Deny only when the body carries one of these keys with a value other than undefined. */
  bodyKeys?: string[];
}

/**
 * Epic 99 D4: a Login as (`imp`) session may not call this route.
 * DenyWhenImpersonatingInterceptor refuses it with 403 IMPERSONATION_DENIED.
 * Method or class level. Every marked route is pinned by
 * `src/impersonation-deny-list.snapshot.txt`.
 */
export const DenyWhenImpersonating = (opts?: DenyWhenImpersonatingOptions) =>
  SetMetadata(DENY_WHEN_IMPERSONATING_KEY, opts ?? true);
