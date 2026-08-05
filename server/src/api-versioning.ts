import { VersioningOptions, VersioningType } from '@nestjs/common';

/**
 * Single source of truth for the current API version segment — main.ts and
 * the e2e helper both read this. Only covers today's single-version setup
 * (every route defaults to this version); running two versions side by
 * side (e.g. during a deprecation window) needs more than changing this
 * value — see the README's "API Versioning" section.
 */
export const API_VERSION = '1';

/**
 * URI over header versioning: it's visible in logs, curl-able, cacheable,
 * and trivially routable at nginx (a broad `location /api/` prefix match,
 * no rewrite needed) — all of which matter more here than header purity.
 */
export function buildVersioningOptions(): VersioningOptions {
  return { type: VersioningType.URI, defaultVersion: API_VERSION };
}
