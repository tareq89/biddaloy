# SchoolManager branding and compatibility

The public product name is **SchoolManager**. Use that exact casing in prose,
titles, UI labels, messages, manifests, and generated customer documentation.
Use `schoolmanager` only for a public lowercase slug that explicitly needs one.

The repository still contains the former name in compatibility-sensitive
identifiers. These are deliberately unchanged:

- `@biddaloy/*` workspace package scopes and TypeScript import aliases.
- Database, S3 bucket, Docker image, volume, and test-resource names.
- Local-storage and IndexedDB keys used by existing browsers.
- Seeded test email addresses and external test URLs.
- Migration history, historical GitHub URLs, and generated identifiers that
  existing integrations may already store.
- The calendar feed `PRODID`, which subscribers use to identify the producer.
- The internal `Biddaloy Sans` font family name in the committed font assets.

Changing any of those identifiers requires a separate migration, compatibility
window, and rollback plan. A branding change must not silently invalidate
existing data or deployed clients.
