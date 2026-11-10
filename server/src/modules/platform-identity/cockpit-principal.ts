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
  if (typeof user !== 'object' || user === null) return false;
  const u = user as Record<string, unknown>;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  return u.typ === 'cockpit' && text(u.sub) && text(u.jti) && text(u.fam);
}
