import { SupportAccessMode } from '@biddaloy/shared';
import type { SupportAccessSettings } from '@biddaloy/shared';
import { DEFAULT_SUPPORT_ACCESS_SETTINGS } from './tenant-settings-defaults';

const MODES = Object.values(SupportAccessMode) as string[];

/**
 * [99.1.04] Valid `SupportAccessSettings` from whatever is stored, else the
 * default. Read-side guard: the PATCH can never write this key, so a bad value
 * can only come from a hand edit or a restore, and must fail safe.
 */
export function readSupportAccess(
  settings: Record<string, unknown> | null | undefined,
): SupportAccessSettings {
  const raw = settings?.supportAccess;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SUPPORT_ACCESS_SETTINGS };
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.mode !== 'string' || !MODES.includes(s.mode)) {
    return { ...DEFAULT_SUPPORT_ACCESS_SETTINGS };
  }
  return {
    mode: s.mode as SupportAccessMode,
    confirmedAt:
      typeof s.confirmedAt === 'string' && !Number.isNaN(Date.parse(s.confirmedAt))
        ? s.confirmedAt
        : null,
    confirmedBy: typeof s.confirmedBy === 'string' ? s.confirmedBy : null,
    textVersion:
      typeof s.textVersion === 'number' && Number.isInteger(s.textVersion) && s.textVersion >= 0
        ? s.textVersion
        : DEFAULT_SUPPORT_ACCESS_SETTINGS.textVersion,
  };
}

/** Copy of `settings` with `supportAccess` replaced; other keys kept. The caller writes and invalidates the cache. */
export function withSupportAccess(
  settings: Record<string, unknown> | null | undefined,
  next: SupportAccessSettings,
): Record<string, unknown> {
  return { ...(settings ?? {}), supportAccess: next };
}
