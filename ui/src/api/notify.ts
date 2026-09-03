/**
 * [8.14.11] The one place a product flow turns an async outcome into a
 * bell entry. Thin on purpose: `notification-state.ts` owns the store,
 * this module owns *intent* — mapping a mutation's result to a
 * `pushNotification` call — so a future dedupe/rate-limit rule has a
 * single place to live rather than being copy-pasted into every producer.
 *
 * `tenantId` is always the value captured *before* the async operation
 * started, never a fresh `getActiveTenant()` read at push time —
 * `pushNotification` already drops a record whose tenant no longer
 * matches the active one (`notification-state.ts:71`), and re-reading
 * here would defeat that guard by always agreeing with itself.
 */
import { i18n } from '../i18n/i18n';

import { getActiveTenant } from './auth-state';
import { pushNotification, type NotificationVariant } from './notification-state';

/** Call at the top of a handler, before the request goes out, and pass the
 * result to `notifyOutcome` from the mutation's own callbacks. */
export function captureNotificationTenant(): string | null {
  return getActiveTenant();
}

export interface NotifyOutcomeInput {
  /** From `captureNotificationTenant()`, taken before the operation
   * started — never a `getActiveTenant()` read at push time. */
  tenantId: string | null;
  variant: NotificationVariant;
  /** Already-translated human text, per `NotificationRecord.message`'s
   * own contract. Components resolve this with `useTranslation`. */
  message: string;
}

export function notifyOutcome({ tenantId, variant, message }: NotifyOutcomeInput): void {
  pushNotification({ tenantId, variant, message });
}

export interface NotifyOutcomeFromCommonInput {
  tenantId: string | null;
  variant: NotificationVariant;
  /** A key inside the `common` namespace, without the `common:` prefix. */
  key: string;
  options?: Record<string, unknown>;
}

/**
 * For **non-React** producers only — today, the offline mutation queue
 * (`mutation-queue.ts`), which runs at module scope with no component to
 * hang `useTranslation` off of.
 *
 * Restricted to the `common` namespace deliberately: `common` is the only
 * namespace i18next loads eagerly (`../i18n/i18n.ts:17,55`), so it's the
 * only one a module-scope caller can resolve *synchronously*. A key in
 * any other namespace would render as a raw key string on a cold session.
 *
 * **Components must not call this** — a component with `useTranslation`
 * should resolve its own string and call `notifyOutcome` with it.
 */
export function notifyOutcomeFromCommon({
  tenantId,
  variant,
  key,
  options,
}: NotifyOutcomeFromCommonInput): void {
  notifyOutcome({ tenantId, variant, message: i18n.t(key, options ?? {}) });
}
