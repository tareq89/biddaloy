# Print module — templates, ID cards and print history

The print module turns a **template** plus a **person** (a student or a staff
member) into a printed **document** — today, ID cards. Every print is logged, so
a card can be reprinted, checked (by scanning its QR code) or cancelled later.

This is Epic 32.0 (D1–D60, issue #812). Later epics (exam admit cards, report
cards, certificates, transfer certificates) add new _document kinds_ to it
instead of building their own printing.

## 1. The big picture

```mermaid
flowchart LR
  subgraph Design["Design (admin)"]
    S[Suggestion<br/>ready-made artwork] --> T[Template<br/>editable draft]
    SVG[Designer's SVG<br/>with field placeholders] --> T
    T -->|Publish| V[Version<br/>frozen, numbered]
  end
  subgraph Print["Print (front office)"]
    P[Person<br/>student / staff] --> R[Resolver<br/>turns fields into values]
    V --> R
    R --> J[Print job + items<br/>values are copied in]
    J --> B[Browser print window<br/>the school's own printer]
  end
  J --> H[History<br/>view, reprint, revoke]
  J --> Q[QR code on the card]
  Q --> W[Public page /v/token<br/>VALID or REVOKED]
```

**Why the browser prints, not the server.** The server never makes a PDF
(D1, D2). Bangla text needs proper shaping (joined letters) and the browser
already does that correctly with the fonts we load. A server-side PDF would need
its own shaping engine, and would still not know which physical printer the
school picks. So the server stores data and the browser draws the page.

## 2. The six tables

```mermaid
erDiagram
    School ||--o{ PrintAsset : owns
    School ||--o{ PrinterProfile : owns
    School ||--o{ PrintTemplate : owns
    PrintTemplate ||--o{ PrintTemplateVersion : "published as"
    PrintTemplate ||--o| PrintTemplateVersion : "current_version_id"
    PrintTemplateVersion ||--o{ PrintJob : "printed with"
    PrinterProfile ||--o{ PrintJob : "printed on"
    PrintJob ||--o{ PrintJobItem : "one per person"
```

| Table                     | What it is                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `print_assets`            | An uploaded file: card **ARTWORK** (SVG/PNG/JPG), an **IMAGE** (signature, seal) or a **FONT**. SVGs are cleaned on upload.             |
| `printer_profiles`        | One physical printer's corrections: margins, X/Y offset, scale (0.9–1.1), duplex order, sheet gap. Type is `CARD` or `OFFICE` (A4).     |
| `print_templates`         | The editable **draft** (JSON), name, document kind, batch size, `is_default`, and `current_version_id`.                                 |
| `print_template_versions` | A published, numbered copy of the draft. **Immutable** — a database trigger refuses any update.                                         |
| `print_jobs`              | One press of Print: who, which version, which printer, `OPEN` until the user confirms, then `CONFIRMED`.                                |
| `print_job_items`         | One row per person in the job: a **snapshot** of the values printed, the copy number, the hashed verify token, outcome, revoked or not. |

Every table carries `tenant_id`. Storage keys are tenant-prefixed
(`tenants/<schoolId>/…`), and a restore from another school's workbook rewrites
that prefix so a restored school never points at someone else's files.

## 3. The two-layer template

A template is **artwork** (a picture, drawn by a designer) plus **fields**
(text, photos and QR codes placed on top by the editor).

```mermaid
flowchart TB
  subgraph Card["One card side"]
    A["Layer 1 — background artwork<br/>logo, colours, border. Static."]
    F["Layer 2 — elements<br/>name, class, photo, QR. Filled per person."]
  end
  A --- F
```

Layer 2 lives in the template's JSON. A real (trimmed) example:

```json
{
  "page": { "widthMm": 54, "heightMm": 85.6, "sides": ["front", "back"] },
  "front": {
    "background": { "assetId": "0b7c…", "print": true },
    "elements": [
      {
        "id": "front-1",
        "type": "TEXT",
        "x": 4,
        "y": 52,
        "w": 46,
        "h": 7,
        "field": "student.name",
        "fontFamily": "Biddaloy Sans",
        "sizePt": 11,
        "weight": 700,
        "color": "#111111",
        "align": "center",
        "overflow": "SHRINK"
      },
      {
        "id": "front-2",
        "type": "IMAGE",
        "x": 12,
        "y": 14,
        "w": 30,
        "h": 36,
        "field": "student.photo",
        "fit": "COVER",
        "alignY": "top"
      }
    ]
  },
  "copyLabel": { "text": "Copy {n}" }
}
```

- Positions are in **millimetres**. The same JSON draws the editor canvas, the
  preview and the printed page, so what you see is what prints.
- `overflow` says what happens to a long name: `SHRINK` (smaller text),
  `WRAP`, `CLIP`, or `FLAG` (mark the card as "needs attention" in the preview).
- `background.print: false` keeps the artwork on screen but does not print it —
  for schools that print on pre-printed card stock.
- The schema is `shared/src/print/template-definition.ts`. The server validates
  every save with it; the editor's reducer refuses any change that would make
  the draft invalid.

### The field catalog

`shared/src/print/field-catalog.ts` lists, per document kind, every field a
template may use (`student.name`, `student.photo`, `school.logo`,
`print.verify_qr`, …) with a sample value and a "longest realistic value" (used
by the editor's **Longest values** switch to test overflow).

## 4. One print, step by step

```mermaid
sequenceDiagram
  participant U as Staff
  participant C as Browser (client-admin)
  participant S as Server
  participant W as Print window
  U->>C: Print ID cards
  C->>C: Open blank print tab (must happen inside the click)
  C->>S: POST /print-jobs (template, people, printer)
  S->>S: Resolve fields, copy values into job items,<br/>give each copy a number and a QR token
  S-->>C: job id + items (values, verify links)
  C->>W: Draw pages from the frozen version + values
  W-->>U: Browser print dialog → the school's printer
  U->>C: "Did all print?" — yes / these failed
  C->>S: PATCH /print-jobs/:id/confirm (failed items)
  S->>S: Job becomes CONFIRMED; next batch unlocks
```

Rules that keep this honest:

- **The job is created first (D9).** If the server says no (no permission, a
  bad template), nothing is drawn. A card is never printed without a log row.
- **Batches are locked in order (D10).** A big class is split into batches
  (the template's `batch_size`, at most 200). Batch 2 unlocks only after batch 1
  is confirmed, so a printer jam cannot silently lose 60 cards.
- **The browser cannot tell which printer was chosen** in its own dialog, so the
  staff member picks the printer profile themselves (D21). It supplies margins,
  offset and scale. The last choice is remembered per school in the browser.
- **A reprint is a new job** with `reprint_of_job_id` set and the next copy
  number. It reuses the stored snapshot, so it looks identical even if the
  student has since changed class.

## 5. Invariants

| Rule                                                                                         | Enforced by                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A published version never changes.                                                           | `trg_print_template_versions_immutable` (blocks UPDATE).                                           |
| A version number is never reused within a template (`1, 2, 3…`).                             | `UNIQUE (template_id, version)`; publish runs in one transaction.                                  |
| A job item stores the values it printed. Editing a student later does not change history.    | `data_snapshot` copied at job creation.                                                            |
| Copy numbers per person and document never repeat, even with two people printing at once.    | Advisory lock in `PrintJobsService.insertItem` + `UNIQUE (tenant, subject, kind, copy_number)`.    |
| The QR token is stored only as a hash.                                                       | `verify_token_hash`; the plain token exists only in the response.                                  |
| The public page shows **only** document type, holder name, school, issue date, copy, status. | Allow-list in `PublicVerifyService`; never ids or photos (D22).                                    |
| The public route is rate limited and needs no login or tenant header.                        | `PUBLIC_VERIFY_RATE_LIMIT` (30 per minute), `GET /public/verify/:token`.                           |
| Uploaded SVGs cannot carry scripts or remote references.                                     | `svg-sanitize.ts` (allow-list of elements and attributes).                                         |
| A staff card needs the HR permission too.                                                    | `STAFF_HR_READ` checked next to `DOCUMENT_PRINT` (D18).                                            |
| At most one live default template per document kind.                                         | Partial unique index `UQ_print_templates_default_per_kind`; `setDefault` swaps in one transaction. |

### Who can do what

| Permission              | Admin | Accountant | Executive | Meaning                    |
| ----------------------- | :---: | :--------: | :-------: | -------------------------- |
| `PRINT_TEMPLATE_MANAGE` |   ✔   |            |           | Templates, files, printers |
| `DOCUMENT_PRINT`        |   ✔   |     ✔      |           | Print and reprint          |
| `PRINT_HISTORY_READ`    |   ✔   |            |     ✔     | See what was printed       |
| `DOCUMENT_REVOKE`       |   ✔   |            |           | Cancel a printed card      |

A role that is not allowed gets **403** `Requires permission(s): …` from
`PermissionsGuard`. No print route carries `@Roles` (Epic 24.0 retired them),
and `print.e2e-spec.ts` asserts 403 — for example an ACCOUNTANT on
`GET /print-history` (it lacks `PRINT_HISTORY_READ`).

## 6. Where the code lives

```text
shared/src/print/                 template schema, field catalog (used by server AND client)
server/src/modules/print/
  templates/   assets/   printers/   jobs/   verify/
  catalog/     field resolvers (student-card.resolver.ts, staff-card.resolver.ts)
  suggestions/ ready-made templates + SVG artwork
ui/src/hooks/print.ts             all API hooks
ui/src/components/…               buildPrintDocument, openPrintWindow (the print page)
client-admin/src/components/print/
  library/  editor/  preview/  history/  student-photo-card.tsx  desktop-only-gate.tsx
client-admin/src/routes/_staff/
  print-templates/  print/preview.tsx  reports/printables.tsx
client-admin/src/routes/v/$token.tsx   the public verify page
```

The editor and the preview are **chromeless** routes (no sidebar or header): a
route sets `staticData: { chromeless: true }` and `_staff.tsx` skips `AppShell`.
Both need a wide screen; under 768 px `DesktopOnlyGate` shows "open this on a
computer".

## 7. Adding a new document kind (checklist for the next epics)

Example: "Exam admit card".

1. **Enum** — add `EXAM_ADMIT_CARD` to `DocumentKind` in
   `shared/src/enums/print.ts`.
2. **Fields** — add its entry to `FIELD_CATALOG` in
   `shared/src/print/field-catalog.ts`: key, type (`text`/`image`/`qr`), sample,
   and a longest sample for text.
3. **Resolver** — write `server/src/modules/print/catalog/<kind>.resolver.ts`
   returning the values for a list of subject ids, and register it in
   `RESOLVERS` (`field-resolver.ts`). Decide the extra permission it needs (like
   `STAFF_HR_READ` for staff cards).
4. **Suggestions** — add ready-made artwork and layout to
   `server/src/modules/print/suggestions/`.
5. **Labels** — `print.field.<key>` and the kind name in `printTemplates.json`,
   `printEditor.json`, `verify.json` (en **and** bn).
6. **Entry points** — a Documents tab or list action that opens
   `/print/preview?kind=…&subject_type=…&ids=…`, and a palette action in
   `action-registry.ts`.

If a step is skipped, a test fails: the field-catalog spec, the
resolver-registry test and the `en`/`bn` key parity check each guard one step.

## 8. Known limits (honest list)

- Very large selections travel in the URL as comma-joined ids.
- `SHRINK` text is fitted in the editor/preview canvas; the static print output
  uses the same font size, so `FLAG` (or Longest values in the editor) is the
  safe way to catch long names.
- Text/DPI checks are hints; there is no server-side render to verify.
