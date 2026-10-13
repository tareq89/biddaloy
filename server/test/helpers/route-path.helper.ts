// Shared by the route e2e specs. Lives outside a spec file so importing it
// does not register (and re-run) another spec's describe blocks.

// Nest stores '/' as an index route's own path metadata (e.g. bare
// `@Get()`), which `filter(Boolean)` keeps (it's a non-empty string) — left
// alone, that produces a trailing slash (`/students/`) that would never
// match a human writing `/students` into the allowlist by hand. Stripped
// here, once, so every path this file produces is the same shape a person
// would naturally write.
export function buildFullPath(controllerPrefix: string, routePath: string): string {
  return `/${[controllerPrefix, routePath].filter(Boolean).join('/')}`
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
}

// Nest's RequestMethod enum (from @nestjs/common) — duplicated as a small
// literal map rather than imported, since only the numeric value stored in
// route metadata is available here and this keeps the mapping self-evident.
export function RequestMethodName(method: number): string {
  const names: Record<number, string> = {
    0: 'GET',
    1: 'POST',
    2: 'PUT',
    3: 'DELETE',
    4: 'PATCH',
    5: 'ALL',
    6: 'OPTIONS',
    7: 'HEAD',
  };
  return names[method] ?? `UNKNOWN(${method})`;
}
