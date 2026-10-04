# Epic 31.0 — UX retrofit — decisions (final for planning; cite by number, never restate)

The user asked for the whole plan in one step and will review in the tickets, so every decision
below is the recommended option, taken and logged.

## Scope
- D1 No new feature, entity or route. Existing screens are made to look and behave like one product, on phone and desktop.
- D2 Every existing page gets a redesign ticket with before/after screenshots at 1440 px and 390 px, all built from ONE pattern kit (`kit/patterns.html`). Not redesigned: `/dashboard` (real dashboard is Epic 8.15 #378), the print-template editor canvas (desktop tool), pure redirect routes.
- D3 Territory. Shared code (`ui/src/**`, layouts `_staff.tsx` / `portal.tsx` / `_platform/route.tsx`, registries `nav-tree.ts`, `route-crumbs.ts`, `action-registry.ts`, `unregistered-actions.ts`, `route-permissions.ts`, `e2e/route-manifest.json`, `nav.json`, `common.json`) is owned by foundation tickets (waves 1–3, 5). A page ticket owns only its own route files, its own feature folder, its own locale namespace files and its own specs. A page that needs something shared does not edit it — it lists the need in `shared-requests.md`.
- D4 Notifications stay client-side: the store is persisted per user+school in the browser (cap 1000) and the page lists them with infinite scroll. `ponytail:` a server notification feed is a new feature — add it when notifications must come from other people's actions.

## Formats (one function each, in `ui/src/utils`)
- D5 Every date on screen is long form: en `9th September, 2026`, bn `৯ই সেপ্টেম্বর, ২০২৬` (bn ordinals: ১লা, ২রা, ৩রা, ৪ঠা, ৫ই–১৮ই, ১৯শে–৩১শে). Date-time: `9th September, 2026, 3:45 PM` / `৯ই সেপ্টেম্বর, ২০২৬, বিকাল ৩:৪৫`. Month label: `October 2026` / `অক্টোবর ২০২৬`. ISO strings only in exports, URLs and API calls.
- D6 Numerals follow the tenant's numeral setting for every number, amount, count and date (no mixed digits: `৳৫০০.০০`, never `৳৫০০.00`). Latin digits stay only in identifiers a person copies or dials: registration/invoice/receipt numbers, phone numbers, emails, codes.
- D7 Time is 12-hour without seconds: `8:00 AM` / `সকাল ৮:০০`.
- D8 Phone numbers display as `01711-000004` everywhere.
- D9 Raw technical values are never shown: no UUIDs, no i18n keys, no enum constants (`CASH`, `Father`, `None`), no regex/locale codes, no backend error strings. Entities show their name; enums show a translated label; errors show a translated sentence.

## Shell
- D10 Sidebar: every item has its own distinct icon. Exactly one item is active — the most specific match (clone `hasDescendantItem` + `exact` from `ui/src/components/bottom-nav.tsx`). Groups re-expand when the route moves into them (#879). The `/exams` link gets its name (#1221). Same rule in the portal sidebar.
- D11 Desktop top bar keeps its composition: school + role, search (`Ctrl+K`), bell, language, theme, account.
- D12 Phone top bar is one sticky 56 px row, identical on staff / portal / platform: left = menu button + school name (truncates); right = search, bell, account. Language, theme, security, switch school and sign out live in the account menu.
- D13 Phone drawer: full-height sheet sliding from the start edge, with a sticky header — brand on the left, a 44 px close button on the top right that never scrolls away.
- D14 Phone bottom bar: `fixed` to the viewport bottom on every signed-in page (staff, portal, platform); the page reserves its height so content never hides behind it and short pages show no stray gap above it. 4 cells + More, chosen per role, one-line labels, the current cell is marked, More is marked when the page is not in a cell. It is hidden only inside a full-page modal (D22), which has its own action footer.
- D15 Content is always centred: list/detail pages `max-w-screen-xl`, forms and reading pages `max-w-3xl`, gutters 16 px on phone and 24 px on desktop. The container comes from the shells (`PageContainer`); a page never sets its own `max-w-*`.
- D16 Page header, same on every page: breadcrumbs, then one `h1` whose text equals the nav label and the last crumb, optional one-line subtitle under it, actions on the right — exactly one filled primary, others outline, rare ones in a "More" menu. On phone the primary action stays visible.
- D17 Spacing scale (4 px steps), one value per container type: page gutter 16/24, gap between sections 24, card padding 16 on phone / 20 on desktop, dialog padding 20 on every side with header/body/footer sharing the same horizontal padding, form field gap 16, label-to-control gap 6. Written into `09-design-direction.md` as tokens.
- D18 Anything clickable shows `cursor: pointer` (global base rule); disabled shows `not-allowed`.

## Components
- D19 Table row actions are icon buttons with a tooltip that names the action, coloured by intent: view/open neutral, edit brand, pay/approve success, print/download neutral, delete/remove danger. At most 3 icons; more go into a "More" menu with icon + text. Every table shows its total: paginated `Showing 1–25 of 312` + rows-per-page, unpaginated `Total 12`. Default page size 25 everywhere. An empty table shows the empty state and no pager.
- D20 Tabs switch — only the selected panel is visible (fix `forceMount` in `ui/src/shells/detail-shell.tsx:211`). Tab list is left-aligned, one row, scrolls sideways when it does not fit, underline style, selected tab in the URL.
- D21 Dialog sizes `sm` 400 / `md` 560 / `lg` 720; Cancel (outline) then primary on the right. A form becomes a full-page modal (D22) when it has more than 6 fields, or steps, or contains a table / list / preview.
- D22 Full-page modal (`FullPageShell`): covers the app chrome and is reflected in the address bar (its own route where one exists, otherwise a search param on the host route). Sticky header: title on the left, a very visible Close button (X + word, 44 px) on the top right. Body centred (`max-w-3xl` forms, `max-w-5xl` when it holds a table or preview). Sticky footer: secondary action left, primary right. Esc and Close ask before discarding changes; closing returns to where the user came from.
- D23 A task opened from a button is a modal or full-page modal; a task that has its own sidebar item stays a page. Full-page modals: add/edit/import student, add/import homework, import calendar, new promotion run, record payment, generate fees, fee schedule form, survey form, generate fines, generate seat plan, ACR form, print preview with the ID-card picker, new school.
- D24 Filter bar: every control has a visible label. Phone: search field + one "Filter (n)" button opening a bottom sheet; active filters show as removable chips; one "Clear all".
- D25 Forms: every field has a visible label; date and select fields show a placeholder (`তারিখ বাছুন`, `বাছুন`); required fields are marked; no browser-native select/date/time/month control anywhere; an empty select keeps its full width.
- D26 Calendar and date picker share one month component: header `অক্টোবর ২০২৬` with icon prev/next and a "Today" button; today is ringed and selected by default. Desktop calendar page: month grid with event chips + a panel for the selected day. Phone: full-width month grid with event dots, the selected day's events listed under it; no grid/agenda toggle.
- D27 Status is always a `StatusBadge` with tone + icon (success / warning / danger / info / neutral) — never plain text.
- D28 Empty state: icon, title, one sentence, one action. Error state: translated sentence + Retry. Loading: skeleton shaped like the content.
- D29 Buttons: one filled primary per view; outline secondary; ghost tertiary; red filled only inside a confirm dialog; underlined links only for navigation inside text.
- D30 Settings: 7 categories in a side list (`?section=`): School · Academics · Finance · Communication · Printing · Sign-in & security · Backup. Phone: category list first, then the section with a back control. Each section keeps its own Save. Technical regional fields sit under "Advanced".
- D31 Bell badge: pill (`min-w-5 h-5 px-1`), holds 4 digits (`9999`, then `9999+`), text colour from a real token with ≥ 4.5:1 contrast in both themes.
- D32 Wording: page title = breadcrumb = sidebar label. One glossary (en + bn) fixes jargon ("Dues queue", "Batch", "Run", "Commit", "Slug", "Step-up approval"…) and uses one word per thing (`শ্রেণি`, not `ক্লাস`). The glossary ticket owns `nav.json` / `common.json`; each page ticket applies it inside its own namespace.
- D33 Portal and platform use the same `AppShell` and every rule above. Platform nav: Schools, Holiday sets.
- D34 Guest pages share one `AuthLayout`: logo, centred card `max-w-md`, language switcher top right, plain wording (no "token", no "staff account").

## Guards and close-out
- D35 Palette: the create/record dialogs get registered; the rest of the 75 `UNREGISTERED_ACTIONS` are allow-listed with a reason. One registry ticket, after the pages.
- D36 One keyboard-journey spec per nav group (8), not one per route.
- D37 Lint/CI guards for the rules that can be checked mechanically: no raw `<select>` / `<input type="date|time|month">`, no `toLocale*String` / ISO slicing for display, no `max-w-*` wrapper in route files, table action columns use `RowActions`.
- D38 Mockups use Bangla (the default locale) with obviously fake data.
- D39 GitHub caps a parent at 100 sub-issues, so #811 holds the foundation tickets plus one child epic, "31.4 Page redesigns", which holds every page ticket with a lane table.
- D40 `/fees` (placeholder) redirects to `/fees/dues`. The collections-report crash is fixed in that page's ticket, which also owns `ui/src/hooks/reports.ts`.
