# [31.4.guardians-1] Guardians list — one primary, labelled filters, readable values

## Goal
`/guardians` matches the "after" screenshots: one filled "অভিভাবকদের আমন্ত্রণ জানান", labelled filters (sheet on phone), relationship shown in Bangla, phones as `01711-000001`, an eye icon instead of the underlined "দেখুন", a visible total and 25 rows per page.

## What and why
Staff use this page to find a guardian and open their page (contact details, children, payments), and admins use it to invite guardians to the portal. Today the only action is an outline button, the relationship filter is a free-text box whose placeholder is its only label and which must match the stored value exactly, the relationship column shows raw `Father` / `Mother`, phones read `+880 1710-100004`, the row action is an underlined text link and the pager never says how many guardians there are. The redesign keeps every capability and puts it into the kit patterns: PageHeader with one primary, FilterBar with labels and a phone sheet, DataTable with RowActions and TableCount.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/guardians/guardians/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Breadcrumb | Gone (one-crumb trail; the layout hides it after 31.3.5). Nothing to do in this file. | D16 |
| 2 | Header | `PageHeader` title "অভিভাবক", no subtitle. The invite button becomes the **filled** primary (`send` icon), shown only with `USER_CREATE` as today. Phone: full width. | D16, D29 — the page had no primary |
| 3 | Search | Visible label "খুঁজুন" (`list.searchLabel` text changes), placeholder "নাম, ফোন বা ইমেইল" (**New** key). | D24 |
| 4 | Relationship filter | A select "সম্পর্ক" with "সকল সম্পর্ক" + 9 options labelled from `common:enums.relationship.*` (বাবা, মা, ভাই, বোন, দাদা / নানা, দাদি / নানি, চাচা / মামা, চাচি / খালা, অন্যান্য) instead of a free-text box. **New** options. | D24/D25; typing "father" never matched "Father" |
| 5 | Primary-contact filter | Checkbox label "শুধু প্রধান যোগাযোগ" (**New** key) instead of the column name. | Says what ticking it does |
| 6 | Relationship column + card subtitle | Translated label (`বাবা`), anything not in the list shown as typed, empty `—`. | D9 |
| 7 | Phone column | `formatPhone` → `01711-000001`. The local helper `-format-guardian-phone.ts` is deleted (31.2.1b made `formatPhone` non-throwing). | D8, B22 |
| 8 | Linked students | First two names, then "+n জন" in `text-text-secondary` (**New** key) instead of an unbounded comma list. | Rows stay one line |
| 9 | Row action | `RowActions` with one `view` action (eye icon + tooltip "দেখুন", link to the detail). Header "কার্যক্রম" → "কাজ". | D19 |
| 10 | Footer | `TableCount` "১–২৫ দেখানো হচ্ছে, মোট ২৮৭" + rows-per-page + pager; default 25. | D19, B23 |
| 11 | Empty / error | `EmptyState` title `list.emptyMessage`, sentence `list.emptyExplanation` (**New**), outline invite action when allowed. Error stays `list.errorMessage` via `ErrorState`. | D28 |
| 12 | Invite dialog | `DialogContent size="lg"` (was `max-w-2xl`); each preview row shows the channel as its translated label (`এসএমএস`), not `SMS`; `text-sm`/`text-muted-foreground` → kit tokens. Steps, preview and result logic unchanged. | D9, D21 sizes |

## Mobile behaviour
- Header: title, then the primary at full width (no More — there is only one action).
- Filters: search field + outline "ফিল্টার (n)" opening the `FilterSheet` (relationship, medium, primary-only checkbox; footer "সব মুছুন" + "n টি ফলাফল দেখুন").
- Table becomes cards: name `text-h3` + StatusBadge, relationship as subtitle, `dl` with phone, preferred medium, linked students; action row "দেখুন" with the eye icon.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Invite button weight | outline · filled | filled | It is the page's only action; D16 wants one primary. |
| Relationship filter | free text · select | select of the 9 glossary relationships, values `Father` … `Other` (capitalised English, as the seed and the student form write them) | Server matches `guardian.relationship = :relationship` exactly (`server/src/modules/students/students.service.ts:753-756`); a select at least sends a value that exists. Rows stored in another case (`OTHER` default at `:667`) are reachable only after the server request below. |
| Invite as dialog or full page | `Dialog lg` · `FullPageShell` | keep `Dialog`, size `lg` | 31.5.1a opens it from `?invite=1` as a modal and 31.5.1b registers it as "modal"; the preview is a short list. |
| Delete the phone helper | keep · delete | delete | 31.2.1b says the page ticket deletes it; `formatPhone` no longer throws. |

## Files
- `client-admin/src/routes/_staff/guardians/index.tsx` — header, filters, columns, RowActions, page size, empty state
- `client-admin/src/routes/_staff/guardians/index.test.tsx` — update assertions
- `client-admin/src/routes/_staff/guardians/-relationship-label.ts` — **New**: `RELATIONSHIP_VALUES`, `relationshipLabel()`
- `client-admin/src/routes/_staff/guardians/-relationship-label.test.ts` — **New**
- `client-admin/src/routes/_staff/guardians/-invite-guardians-dialog.tsx` — size, channel label, tokens
- `client-admin/src/routes/_staff/guardians/-invite-guardians-dialog.test.tsx` — channel label assertion
- `client-admin/src/routes/_staff/guardians/-format-guardian-phone.ts` — **deleted**
- `client-admin/src/routes/_staff/guardians/-format-guardian-phone.test.ts` — **deleted**
- `client-admin/src/routes/_staff/guardians/-detail/information-tab.tsx` — import swap only (`formatPhone`); restyled later by guardians-2
- `ui/src/i18n/locales/bn/guardians.json`, `ui/src/i18n/locales/en/guardians.json` — keys below

## Steps
1. **Relationship helper** (`-relationship-label.ts`):
   ```ts
   export const RELATIONSHIP_VALUES = ['Father','Mother','Brother','Sister','Grandfather','Grandmother','Uncle','Aunt','Other'] as const;
   export function relationshipLabel(value: string | null | undefined, t: TFunction): string {
     const raw = (value ?? '').trim();
     if (raw === '') return '—';
     const key = raw.toLowerCase();
     return RELATIONSHIP_VALUES.some((v) => v.toLowerCase() === key)
       ? t(`enums.relationship.${key}`, { ns: 'common' })
       : raw; // free text a person typed, shown as typed
   }
   ```
   (`common:enums.relationship.*` exists after 31.3.4a. guardians-2 reuses this helper.)
2. **Phone.** Delete `-format-guardian-phone.ts` and its test. In `index.tsx` and `-detail/information-tab.tsx` replace `formatGuardianPhone(x, regionConfig) ?? t('…emptyValue')` with `x ? formatPhone(x, regionConfig) : t('…emptyValue')` (`formatPhone` from `@biddaloy/ui/utils`).
3. **Page size.** `useListShellState({ limit: 10 })` → `useListShellState()`; in `loaderDeps` `limit: search.limit ?? 10` → the shared default from 31.2.4 (`DEFAULT_PAGE_SIZE` from `@biddaloy/ui/shells`; `25` if not exported).
4. **Header.** Replace `primaryAction` with the `ListShell` actions API: `actions={[{ id: 'invite', label: t('invite.trigger'), icon: <SendIcon />, priority: 'primary', allowed: canInvite, onClick: () => setInviteOpen(true) }]}`. Keep the dialog mount and `inviteOpen` state exactly as they are (31.5.1a wires `?invite=1` to them later).
5. **Filters** (`filterFields`, same order):
   - search: `label: t('list.searchLabel')`, `placeholder: t('list.searchPlaceholder')`, `primary: true`.
   - relationship: `{ kind: 'select', key: 'relationship', label: t('list.columnRelationship'), allLabel: t('list.allRelationships'), options: RELATIONSHIP_VALUES.map((v) => ({ value: v, label: relationshipLabel(v, t) })) }`.
   - preferred_communication: unchanged.
   - is_primary_contact: `label: t('list.primaryOnlyFilter')`.
6. **Columns.**
   - `relationship`: `accessorFn: (row) => relationshipLabel(row.relationship, t)`, still `card: 'subtitle'`.
   - `phone`: per step 2.
   - `linkedStudents`: `row.students.length === 0 ? t('list.emptyValue') : <>{row.students.slice(0, 2).map((s) => s.full_name).join(', ')}{row.students.length > 2 && <span className="text-text-secondary"> {t('list.moreStudents', { count: row.students.length - 2 })}</span>}</>`. If the card mode supports a full-width field, give this one the full row; otherwise leave it in the grid.
   - Delete the hand-built `actions` column. Pass `rowActions={(row) => [{ intent: 'view', label: t('list.view'), to: `/guardians/${row.id}` }]}` (the `data-focus-anchor` pass-through is the students lane's open shared request; RowActions items carry `data-focus-anchor` per foundation — set it to `row.id` if the prop exists).
7. **Empty state.** `emptyMessage` → `emptyState={{ title: t('list.emptyMessage'), explanation: t('list.emptyExplanation'), action: canInvite ? { label: t('invite.trigger'), onClick: () => setInviteOpen(true) } : undefined }}`.
8. **Invite dialog.** `<DialogContent className="max-w-2xl">` → `<DialogContent size="lg">`. Preview row: `{entry.full_name} — {t(`preferredCommunicationOptions.${entry.channel}`, { defaultValue: entry.channel })}`. Replace `text-sm text-muted-foreground` with `text-text-secondary`, drop bare `text-sm`, `text-destructive` stays. Nothing else changes.
9. **i18n** (`guardians.json`, bn / en):
   - change `list.searchLabel`: "খুঁজুন" / "Search"
   - add `list.searchPlaceholder`: "নাম, ফোন বা ইমেইল" / "Name, phone or email"
   - add `list.allRelationships`: "সকল সম্পর্ক" / "All relationships"
   - add `list.primaryOnlyFilter`: "শুধু প্রধান যোগাযোগ" / "Primary contacts only"
   - add `list.moreStudents`: "+{{count}} জন" / "+{{count}} more"
   - change `list.columnActions`: "কাজ" / "Actions"
   - add `list.emptyExplanation`: "শিক্ষার্থী যোগ করার সময় তার অভিভাবক যোগ করলে এখানে দেখা যাবে।" / "Guardians appear here when you add them with a student."

## Tests
- `index.test.tsx`: exactly one filled button in the header and it reads "অভিভাবকদের আমন্ত্রণ জানান"; relationship filter is a select with 9 options whose labels are Bangla; a row with `relationship: 'Father'` shows "বাবা" and one with `'Step-father'` shows it as typed; phone renders `01711-000001`; the row has a link named "দেখুন" to `/guardians/<id>`; a guardian with 4 students shows two names and "+২ জন"; default request `limit=25`. Drop the `'+880 …'` expectation (31.2.13 already rewrote it).
- `-relationship-label.test.ts`: `father`, `FATHER`, ` Father ` → "বাবা"; `''`/`null` → "—"; unknown text returned unchanged.
- `-invite-guardians-dialog.test.tsx`: a preview entry with `channel: 'SMS'` shows "এসএমএস".
- E2E: `e2e/journeys/invite-guardians.spec.ts` finds the trigger by name — unchanged. `e2e/pages/pages.proof.spec.ts` uses the `list.searchLabel` / `list.emptyMessage` keys, not their text — unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Relationship reads "বাবা"/"মা", never `Father`/`OTHER`; the filter is a labelled select.
- [ ] Phones read `01711-000001`; `-format-guardian-phone.ts` no longer exists.
- [ ] The row action is an eye icon with a tooltip on desktop and "দেখুন" on phone cards.
- [ ] Footer shows "১–২৫ দেখানো হচ্ছে, মোট N"; 25 rows by default.
- [ ] Invite dialog is 720 px wide and shows channel names in Bangla.

## Out of scope
- Server relationship filter is case-sensitive, so rows stored as `OTHER` or `father` are not found by the new select — filed in shared-requests.md.
- The invite wizard renders its own `h1` inside the dialog (`WizardShell`) — owned by 31.2.5a.
- No row selection / "invite selected" (the dialog comment notes it as a follow-up) — new feature, left out.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| server relationship filter case-insensitive | Accepted | 31.3.7d | send the select value (Father, Mother, …, Other) as planned; the server compares LOWER() both sides |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: guardians   Decisions: D8, D9, D16, D19, D21, D24, D25, D28, D29   Depends on: 31.3.8b
