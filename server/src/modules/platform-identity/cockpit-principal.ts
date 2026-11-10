/**
 * [Epic 98] What `request.user` holds for a cockpit (platform owner) token.
 * The cockpit JWT strategy that produces it lands in Wave 2; the guard only needs the shape.
 */
export interface CockpitPrincipal {
  sub: string;
  jti: string;
  fam: string;
  typ: 'cockpit';
}

export function isCockpitPrincipal(user: unknown): user is CockpitPrincipal {
  return typeof user === 'object' && user !== null && (user as { typ?: unknown }).typ === 'cockpit';
}
