/**
 * [15.5.1] Frozen issuer identity captured onto an invoice or payment at
 * creation time, so a document keeps showing the school identity that was
 * true when it was issued even if the profile changes afterward.
 *
 * `logo_key` is copied as-is (not re-uploaded) so the print flow can
 * request `/schools/:id/logo?v=<uuid>` for that exact object — see
 * [15.5.5]'s note: if that logo object is later deleted, the URL 404s and
 * the print falls back to text-only.
 */
export type IssuerSnapshot = {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_key: string | null;
  captured_at: string;
};

/** Minimal shape `buildIssuerSnapshot`/`resolveIssuer` need from a
 * `School` row — avoids importing the entity class itself into every
 * caller (invoice/payment creation, read DTOs). */
export type SchoolIdentitySource = {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_key: string | null;
};

/** [15.5.5] Freezes `school`'s current identity into an `IssuerSnapshot`,
 * stamped with the moment it was captured. Call this once, at the exact
 * point an invoice/payment is created — never lazily, or the "frozen at
 * issue time" guarantee breaks. */
export function buildIssuerSnapshot(school: SchoolIdentitySource): IssuerSnapshot {
  return {
    name: school.name,
    name_bn: school.name_bn,
    address: school.address,
    phone: school.phone,
    email: school.email,
    registration_id: school.registration_id,
    logo_key: school.logo_key,
    captured_at: new Date().toISOString(),
  };
}

/** [15.5.5] The read-side fallback: a document created before this
 * feature (or one whose snapshot capture somehow failed) has
 * `issuer_snapshot === null` — reads should show the *current* profile
 * for it rather than an empty issuer block. A document created after this
 * feature always has a snapshot, which wins over the live profile even if
 * the profile has since changed — that's the entire point of freezing it. */
export function resolveIssuer(
  doc: { issuer_snapshot: IssuerSnapshot | null },
  school: SchoolIdentitySource,
): IssuerSnapshot {
  return doc.issuer_snapshot ?? buildIssuerSnapshot(school);
}
