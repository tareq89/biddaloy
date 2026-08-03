import { VersioningOptions, VersioningType } from "@nestjs/common";

/**
 * Single source of truth for the API's URI version segment — bumping the
 * API to a new version is one edit here (main.ts and every e2e spec's path
 * helper both read this).
 */
export const API_VERSION = "1";

/**
 * URI over header versioning: it's visible in logs, curl-able, cacheable,
 * and trivially routable at nginx (a broad `location /api/` prefix match,
 * no rewrite needed) — all of which matter more here than header purity.
 */
export function buildVersioningOptions(): VersioningOptions {
  return { type: VersioningType.URI, defaultVersion: API_VERSION };
}
