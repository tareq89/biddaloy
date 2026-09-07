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
