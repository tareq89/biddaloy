/**
 * [15.5.7] The issuer identity block a printed invoice or receipt shows:
 * name (English + Bengali), address, phone, EIIN, and the logo.
 *
 * Mirrors `server/src/modules/schools/profile/issuer-snapshot.ts`'s
 * `IssuerSnapshot` — the shape captured on invoices/payments at issue
 * time ([15.5.5]) and served back for print. `logo_key` is what proves a
 * logo exists; the actual bytes come from `logoUrl`, since only the
 * caller (which already has the tenant id and the document's `logo_key`)
 * can build the versioned `/schools/:id/logo?v=<uuid>` URL — this
 * component has no tenant id to build it from itself.
 */
export interface IssuerSnapshot {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_key: string | null;
}

export interface IssuerHeaderProps {
  issuer: IssuerSnapshot;
  /** Built by the caller from `issuer.logo_key` + the document's tenant id
   * (e.g. `/schools/<tenantId>/logo?v=<uuid-from-logo_key>`) — see
   * `logo-url.ts`'s `buildIssuerLogoUrl`. Omitted (or the image 404s,
   * e.g. after the logo was removed) means no `<img>` renders at all. */
  logoUrl?: string | null;
  /** When `'bn'`, the Bengali name renders first with the English name
   * below it (in that visual order); anything else renders English name
   * first with Bengali below. A missing `name_bn` never blocks the
   * English name from showing. */
  activeLanguage?: string;
}

/**
 * Renders only when there's something to show — a document with no
 * `logo_key` renders no `<img>` at all, and one whose logo object was
 * later deleted (a 404 on `logoUrl`) hides the broken image via
 * `onError` rather than showing a broken-image icon on a printed page.
 */
export function IssuerHeader({ issuer, logoUrl, activeLanguage }: IssuerHeaderProps) {
  const bengaliFirst = activeLanguage === 'bn';
  const primaryName = bengaliFirst ? (issuer.name_bn ?? issuer.name) : issuer.name;
  const secondaryName = bengaliFirst ? (issuer.name_bn ? issuer.name : null) : issuer.name_bn;

  return (
    <div className="flex items-start gap-3 print:gap-3">
      {issuer.logo_key && logoUrl && (
        <img
          src={logoUrl}
          alt={issuer.name}
          className="h-14 w-14 object-contain"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
      <div>
        <div className="text-lg font-semibold">{primaryName}</div>
        {secondaryName && <div className="text-sm text-muted-foreground">{secondaryName}</div>}
        {issuer.address && <div className="text-xs text-muted-foreground">{issuer.address}</div>}
        <div className="flex gap-2 text-xs text-muted-foreground">
          {issuer.phone && <span>{issuer.phone}</span>}
          {issuer.email && <span>{issuer.email}</span>}
          {issuer.registration_id && <span>EIIN: {issuer.registration_id}</span>}
        </div>
      </div>
    </div>
  );
}
