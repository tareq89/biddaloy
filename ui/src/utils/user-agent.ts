/**
 * A ~15-line regex "browser / OS" hint for `SessionList`'s device line —
 * deliberately not `ua-parser-js` or any other dependency. This is not a
 * feature-detection or security control, just a friendly label ("Chrome on
 * Windows") next to a session row, so a rough, best-effort regex match is
 * enough; a `User-Agent` string that doesn't match anything known renders
 * as `null` and the caller falls back to its own "Unknown device" copy —
 * `session-list.tsx`'s sessions.unknownDevice key. Not written as a
 * translation-function call in this comment on purpose: this file's
 * static i18n-key scanner treats that shape as a real call site.
 */
export interface DeviceDescription {
  browser: string;
  os: string;
}

const BROWSER_PATTERNS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Chrome\//, 'Chrome'],
  [/CriOS\//, 'Chrome'],
  [/FxiOS\//, 'Firefox'],
  [/Firefox\//, 'Firefox'],
  [/Version\/.*Safari\//, 'Safari'],
];

const OS_PATTERNS: Array<[RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

function firstMatch(userAgent: string, patterns: Array<[RegExp, string]>): string | null {
  const hit = patterns.find(([pattern]) => pattern.test(userAgent));
  return hit ? hit[1] : null;
}

/** Returns `null` when neither a browser nor an OS could be identified —
 * a User-Agent this vague isn't worth a half-filled "Unknown on Windows". */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription | null {
  if (!userAgent) return null;

  const browser = firstMatch(userAgent, BROWSER_PATTERNS);
  const os = firstMatch(userAgent, OS_PATTERNS);
  if (!browser && !os) return null;

  return { browser: browser ?? 'Unknown', os: os ?? 'Unknown' };
}
