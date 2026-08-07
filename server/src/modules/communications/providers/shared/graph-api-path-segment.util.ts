/**
 * Meta Graph API object ids (WhatsApp phone number id, Page id) are always
 * numeric strings; the api version is always `v<major>.<minor>`. Both
 * `testConnection()` paths build a request URL by interpolating one of
 * these straight from tenant-supplied config — including, for the
 * in-flight "verify before saving" flow, a value that never passed
 * through any DTO validation at all (`TestConnectionDto.config` is
 * intentionally untyped, see its own comment). Rejecting anything that
 * doesn't match the real Graph API shape before it reaches the URL closes
 * that off at the one point both paths go through, rather than trusting
 * either caller.
 */
const GRAPH_API_ID_PATTERN = /^\d+$/;
const GRAPH_API_VERSION_PATTERN = /^v\d+\.\d+$/;

export function isValidGraphApiId(value: string): boolean {
  return GRAPH_API_ID_PATTERN.test(value);
}

export function isValidGraphApiVersion(value: string): boolean {
  return GRAPH_API_VERSION_PATTERN.test(value);
}
