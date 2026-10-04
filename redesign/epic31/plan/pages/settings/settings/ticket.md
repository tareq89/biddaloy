# [31.4.settings-1a] Settings — seven categories with a side list

## Goal
`/settings` shows a side list of 7 categories (D30). The selected one is in the URL (`?section=`). Only that category's sections are on screen. Old links (`#regional-section`, `#attendance-section`, `#organisation-section`, `#printers-section`, `?backup=<jobId>`) open the right category.
(Split from settings-1. **1a** builds the frame and puts every existing section into its category, with the sections unchanged inside. **1b** (`ticket-b.md`, runs after 1a) redesigns the School category's four cards.)

## What and why
Settings is where an admin changes how the school works. Today it is one 14 000 px column with 17 forms and 17 Save buttons. Nobody can find the SMS form without scrolling past 25 ACR criteria, and nothing on screen says where you are. This ticket groups the forms into 7 categories in a side list, like every settings screen people already know. It also adds the two building blocks (`SettingsLayout`, `SettingsSection`) that settings-1b, -2, -3 and -4 use to redesign the cards inside each category.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings/mobile.webp?raw=true" width="260"> |

The "after" shots show the School category as it looks once 1b has landed too. 1a gives the frame (header, side list, phone back link, one category at a time); the cards inside keep today's look until their own ticket runs.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page header | `h1` "স্কুল সেটিংস" → "সেটিংস" (= sidebar label). The subtitle shows the school name: "নমুনা আদর্শ বিদ্যালয়-এর সেটিংস". It replaces the sticky "…এর সেটিংস কনফিগার করা হচ্ছে" banner. | D16, D32; the banner was a second header |
| 2 | Body | **New** `SettingsLayout`: a side list of 7 categories (স্কুল · একাডেমিক · অর্থ · যোগাযোগ · প্রিন্টিং · সাইন-ইন ও নিরাপত্তা · ব্যাকআপ), each with its own icon. Only the selected category's sections are rendered. | D30; one 14 000 px column today |
| 3 | URL | **New** `?section=<id>`. If it is missing: `?backup=` → Backup; a known `#anchor` → its category, then scroll to the anchor; otherwise School (desktop) or the category list (phone). | D30; old links keep working |
| 4 | Sections | Each existing section is put in its category (table in step 3). None is changed inside here. | so no section disappears between tickets |
| 5 | Category list | A category is hidden when the user cannot see any section in it: Printing needs `PRINT_TEMPLATE_MANAGE`, Backup needs `BACKUP_MANAGE`. | no empty screens |
| 6 | Phone | With no category open, the page is the category list (one Card, 48 px rows, chevron). With a category open: a back link "‹ সেটিংস", the `h1` shows the category name, then the sections. | D30 phone rule |
| 7 | Calendar card | The links "রিজিওনাল-এ / অ্যাটেনডেন্স-এ পরিবর্তন করুন" become router links (`#regional-section` in School; `?section=academics#attendance-section`). | a plain `#hash` link cannot switch the category |
| 8 | SUPER_ADMIN school picker | Native `<select>` → `Select` from `@biddaloy/ui`. It sits between the header and the layout. | D25 |
| 9 | **New** `SettingsSection` | The shared section card that 1b/2/3/4 use (built here, first used in 1b). | patterns.md §9 |

## Mobile behaviour
- `/settings` with nothing in the URL = the header + the category list. No sections show.
- Tapping a category goes to `/settings?section=<id>`. The side list hides, a back link "‹ সেটিংস" appears above the header, and the `h1` text becomes the category name.
- Every row and the back link are ≥ 44 px. Each section's Save button is full width (from `SettingsSection`).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where the frame lives | shared `ui` component · page folder | `client-admin/src/pages/settings/settings-layout.tsx` | one consumer; 31.1.2a left it to this ticket |
| How a section joins a category | a config array with components · an explicit `switch` in the page | a `SETTINGS_CATEGORIES` array (id, icon, anchors, allowed) + one `renderCategory(id)` `switch` in `SchoolSettingsPage` | a reader sees exactly which sections are in each category; settings-b adds a section with two lines |
| Section card | wrap each section's `FormShell` · `SettingsSection` owns the `<form>` | `SettingsSection` renders the `<form noValidate>` Card itself. Errors show under each field. The card has no error summary. | after 31.2.5a `FormShell` wraps itself in a narrow `PageContainer`. Inside the content column that would centre every card at 768 px, with a gap beside the side list. A ≤ 10-field card does not need a summary: RHF focuses the first invalid field. |
| Phone heading with a category open | keep "সেটিংস" twice (back link + h1) · h1 = category name | `h1` shows the category name below `md`, and "সেটিংস" from `md` up (two spans) | on phone this is a drill-down level: the back link names the parent, the title names the place |
| Category ids | localised · English slugs | `school, academics, finance, communication, printing, security, backup` | stable URLs; the labels are translated |
| Default on desktop | remember the last category · School | School | simplest; the URL is shareable anyway |

## Files
- `client-admin/src/routes/_staff/settings.tsx` — `section` in the search schema
- `client-admin/src/pages/SchoolSettingsPage.tsx` — header, picker, layout, `renderCategory`
- `client-admin/src/pages/settings/settings-categories.ts` — **New**: categories + `resolveSettingsCategory`
- `client-admin/src/pages/settings/settings-layout.tsx` — **New**: `SettingsLayout`, `SettingsSection`
- `client-admin/src/pages/settings/settings-layout.test.tsx` — **New**
- `client-admin/src/pages/settings/CalendarSection.tsx` — the two links only (also changed by settings-1b, which runs after)
- `ui/src/i18n/locales/en/settings.json`, `ui/src/i18n/locales/bn/settings.json`
- `client-admin/src/pages/SchoolSettingsPage.test.tsx`
- `client-admin/src/routes/_staff/settings.test.tsx`
- `e2e/journeys/backup-restore.spec.ts` — open `/settings?section=backup`

## Steps
1. **Read first:** `PLAN/kit/patterns.md` §9 (SettingsLayout), `PATTERN: SettingsLayout` in `PLAN/kit/patterns.html`, D16, D30. Today's page: `client-admin/src/pages/SchoolSettingsPage.tsx` (199 lines). Icons come from `lucide-react` (PascalCase + `Icon`, as in `_staff.tsx`).

2. **`settings-categories.ts` (new).** This file is the registry that later tickets edit:
   ```ts
   import type { LucideIcon } from 'lucide-react';
   import { Building2Icon, GraduationCapIcon, WalletIcon, MessageSquareIcon, PrinterIcon, LockIcon, DatabaseIcon } from 'lucide-react';

   export const SETTINGS_CATEGORY_IDS = ['school', 'academics', 'finance', 'communication', 'printing', 'security', 'backup'] as const;
   export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

   export interface SettingsCategory {
     id: SettingsCategoryId;
     icon: LucideIcon;
     /** DOM ids of sections in this category that old links point at (`/settings#<anchor>`). */
     anchors: readonly string[];
   }

   export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
     { id: 'school', icon: Building2Icon, anchors: ['regional-section', 'organisation-section'] },
     { id: 'academics', icon: GraduationCapIcon, anchors: ['attendance-section'] },
     { id: 'finance', icon: WalletIcon, anchors: [] },
     { id: 'communication', icon: MessageSquareIcon, anchors: [] },
     { id: 'printing', icon: PrinterIcon, anchors: ['printers-section'] },
     { id: 'security', icon: LockIcon, anchors: [] },
     { id: 'backup', icon: DatabaseIcon, anchors: [] },
   ];

   /** Which category to show. `undefined` = nothing chosen (phone shows the list, desktop shows the first allowed). */
   export function resolveSettingsCategory(
     input: { section?: SettingsCategoryId; backup?: string; hash?: string },
     allowed: ReadonlySet<SettingsCategoryId>,
   ): SettingsCategoryId | undefined {
     const pick = (id: SettingsCategoryId | undefined) => (id && allowed.has(id) ? id : undefined);
     return (
       pick(input.section) ??
       (input.backup !== undefined ? pick('backup') : undefined) ??
       pick(SETTINGS_CATEGORIES.find((c) => input.hash && c.anchors.includes(input.hash))?.id)
     );
   }
   ```
   Put a short header comment at the top. It must say exactly this: **"To add a section to a category: (1) render it inside that category's `case` in `renderCategory` in `SchoolSettingsPage.tsx`; (2) if old links point at it with `/settings#<id>`, give it that `id` and add the id to the category's `anchors` here."**

3. **Category → sections** (today's components, unchanged inside, in this order). Write `renderCategory(id: SettingsCategoryId): React.ReactNode` in `SchoolSettingsPage.tsx` as one `switch`. Sections that need `schoolId && settingsQuery.data` keep that guard inside their case, as they have today.

   | id | Sections, in order |
   |---|---|
   | `school` | `SchoolProfileSection`, `<div id="organisation-section"><OrganisationSection/></div>`, `<div id="regional-section"><RegionalSection/></div>`, `CalendarSection` |
   | `academics` | `<div id="attendance-section"><AttendanceSection/></div>`, `EvaluationsSection`, `{canEditAcrCriteria && <AcrCriteriaSection/>}`, `{canApplyPreset && <PresetLinkCard/>}` |
   | `finance` | `FeesSection` |
   | `communication` | `SmsSection`, `SmsCreditSection`, `WhatsAppSection`, `MessengerSection`, `EmailSection` |
   | `printing` | `PrintersSection` (it already carries `id="printers-section"`) |
   | `security` | `SignInSection` |
   | `backup` | `BackupSection` with `backupJobId` |

   Keep every existing prop and `key={schoolId}` exactly as in today's file.

4. **`settings-layout.tsx` (new)** — copy the classes from `PATTERN: SettingsLayout`.
   ```ts
   export interface SettingsLayoutProps {
     categories: readonly { id: SettingsCategoryId; label: string; icon: LucideIcon }[];
     active: SettingsCategoryId | undefined;   // undefined = phone shows the list
     fallback: SettingsCategoryId;             // what desktop shows when active is undefined
     children: React.ReactNode;                // the sections of (active ?? fallback)
   }
   ```
   - Root `flex flex-col gap-6 md:flex-row md:items-start`.
   - `<nav aria-label={t('categories.label')}>`. Classes: when `active` is set, `hidden md:block md:w-56 md:shrink-0`. When it is not, `rounded-lg border border-border-subtle bg-surface p-1 shadow-e1 md:w-56 md:shrink-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none`.
   - In the nav, a `ul md:space-y-0.5` of TanStack `<Link to="/settings" search={{ section: c.id }}>`. Each link has the item classes `flex h-12 items-center gap-2.5 rounded-md px-3 text-text-secondary hover:bg-muted hover:text-text-primary md:h-9 md:aria-[current=page]:bg-secondary md:aria-[current=page]:font-semibold md:aria-[current=page]:text-secondary-foreground` and `aria-current="page"` when `c.id === (active ?? fallback)`. Inside: the icon (`aria-hidden`, default size like the staff sidebar icons), the label `truncate`, and `ChevronRightIcon` `ms-auto size-4 md:hidden`.
   - Content `<div className={cn('min-w-0 flex-1 space-y-6', active ? '' : 'hidden md:block')}>{children}</div>`.
   - `SettingsSection` (exported from the same file):
     ```ts
     export interface SettingsSectionProps {
       id?: string;                 // DOM id, e.g. 'regional-section'
       title: string;               // rendered as h2
       description?: string;
       badge?: React.ReactNode;     // e.g. a StatusBadge next to the title
       onSubmit?: React.FormEventHandler<HTMLFormElement>;  // omit → renders <section>, no Save
       saving?: boolean;
       saveLabel?: string;          // default t('save.action')
       footerStart?: React.ReactNode; // saved/error message, extra outline buttons (left of Save)
       advanced?: React.ReactNode;  // content of the "উন্নত সেটিং" disclosure
       advancedSummary?: string;    // default t('advanced')
       advancedOpen?: boolean;      // force open (e.g. an error inside)
       children: React.ReactNode;
     }
     ```
     - Markup: `<form noValidate id onSubmit className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">` (`<section>` when there is no `onSubmit`).
     - Title row: `flex flex-wrap items-center gap-x-3 gap-y-1` with `<h2 className="text-h2">` + badge. Description: `mt-0.5 text-text-secondary`. Then `children`.
     - Advanced: `<details className="group/adv mt-4 border-t border-border-subtle pt-2" open={advancedOpen || undefined}>` with `<summary className="flex h-11 cursor-pointer list-none items-center gap-1 font-medium text-text-secondary md:h-8">` (`ChevronRightIcon size-4 group-open/adv:rotate-90`) and the content.
     - Footer, only with `onSubmit`: `mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between`. Left: `<div className="flex flex-col gap-2 md:flex-row md:items-center">{footerStart}</div>`. Right: `<Button type="submit" loading={saving} className="w-full md:w-auto">`.
     - Also export `SettingsSaved` = `<p role="status" className="flex items-center gap-1.5 text-text-secondary"><CircleCheckIcon className="size-4 text-status-paid-fg" />{t('save.success')}</p>` for `footerStart`.

5. **`SchoolSettingsPage.tsx`.**
   - Read `section` and `hash` with `useSearch({ from: '/_staff/settings' })` and `useLocation().hash`. Keep the `backupJobId` prop.
   - `allowed`: a `Set` of every id, minus `printing` when `!useHasPermission(Permission.PRINT_TEMPLATE_MANAGE)`, minus `backup` when `!useHasPermission(Permission.BACKUP_MANAGE)`.
   - `active = resolveSettingsCategory({ section, backup: backupJobId, hash }, allowed)`. `fallback = 'school'`.
   - Root: `<PageContainer size="wide">` from `@biddaloy/ui` (no `max-w-*` / `p-6` of its own, D15).
   - Order inside: (a) phone back link, rendered only when `active`: `<Link to="/settings" search={{}} className="inline-flex h-11 items-center gap-1 font-medium text-primary md:hidden"><ChevronLeftIcon />{t('title')}</Link>`. (b) `<PageHeader title={…} subtitle={schoolName ? t('configuringBanner', { schoolName }) : undefined} />`. The title is a node, not plain text: when `active`, `<><span className="md:hidden">{t(`categories.${active}`)}</span><span className="hidden md:inline">{t('title')}</span></>`; otherwise `t('title')`. If `PageHeader.title` is typed `string`, render the same header markup inline instead (`PATTERN: PageHeader`) — do not change `PageHeader`. (c) The SUPER_ADMIN picker, using the `Select` components: `Field` + visible label `schoolPicker.label`, placeholder `schoolPicker.placeholder`, the trigger in a `md:w-80` wrapper; the error stays `role="alert"`. (d) The settings load error, now `<ErrorState message={t('settingsLoadError')} onRetry={() => void settingsQuery.refetch()} />`. (e) `<SettingsLayout categories=… active fallback>{renderCategory(active ?? 'school')}</SettingsLayout>`.
   - Delete the sticky banner `div`.
   - Anchor scroll: `React.useEffect(() => { if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' }); }, [hash, active, settingsQuery.data]);`
   - Rewrite the doc comment at the top: one paragraph on categories + how to register a section (point to `settings-categories.ts`).

6. **`routes/_staff/settings.tsx`.** Add `section: z.enum(SETTINGS_CATEGORY_IDS).optional().catch(undefined)` next to `backup`. No other change. `action-registry.ts:503` keeps navigating to `/settings#printers-section`; the hash resolver handles it (do not edit the registry).

7. **`CalendarSection.tsx` links (`:201-208`).** Replace the two `<a href="#…">` with `<Link to="/settings" hash="regional-section" search={{ section: 'school' }}>` and `<Link to="/settings" hash="attendance-section" search={{ section: 'academics' }}>`. Keep the existing classes and text (1b restyles them).

8. **i18n `settings.json`, en + bn.**
   - Change: `title` "School settings" → "Settings" / "স্কুল সেটিংস" → "সেটিংস". `configuringBanner` → "Settings for {{schoolName}}" / "{{schoolName}}-এর সেটিংস".
   - Add `categories.label` "Settings categories" / "সেটিংসের বিভাগ".
   - Add `categories.school` "School" / "স্কুল", `categories.academics` "Academics" / "একাডেমিক", `categories.finance` "Finance" / "অর্থ", `categories.communication` "Communication" / "যোগাযোগ", `categories.printing` "Printing" / "প্রিন্টিং", `categories.security` "Sign-in & security" / "সাইন-ইন ও নিরাপত্তা", `categories.backup` "Backup" / "ব্যাকআপ".
   - Add `advanced` "Advanced settings" / "উন্নত সেটিং".
   - Run `yarn workspace @biddaloy/ui check:i18n`.

## Tests
- `settings-layout.test.tsx` (new):
  - `resolveSettingsCategory`: `section` wins; `backup` → `backup`; hash `printers-section` → `printing`; hash `attendance-section` → `academics`; a disallowed `section` (printing without permission) → `undefined`; nothing → `undefined`.
  - `SettingsLayout`: with `active` the nav has `hidden` and the content does not; without `active` the reverse; the current link has `aria-current="page"`.
  - `SettingsSection`: renders an `h2`, a Save button only with `onSubmit`, `advancedOpen` opens the `<details>`.
- `SchoolSettingsPage.test.tsx`:
  - "picking a school shows the banner and every section" → rename it to "…shows the school name in the subtitle and the School category". Assert the subtitle text and that the profile, organisation, regional and calendar legends are present and SMS is not.
  - **Add**: rendered with `?section=communication`, SMS is present and Regional is not; with hash `printers-section`, the Printing link has `aria-current="page"`.
  - The a11y test stays, on the default (School) category.
- `routes/_staff/settings.test.tsx:62`: `'School settings'` → `'Settings'` (match the heading by role, `level: 1`).
- `e2e/journeys/backup-restore.spec.ts:121`: `goto('/settings?section=backup')`; `:233` unchanged (the access-denied state).
- `e2e/keyboard/organisation-structure.spec.ts:131-169` (not in Files — updated by 31.5.0): the heading is still `t('settings.title')` (now "সেটিংস"). The Tab count from the heading to the organisation "add" input now passes the 7 category links and the profile card — raise the `tabUntilFocused` limits if needed. No other change.
- `client-admin/src/routes/_staff/print-routes.test.tsx:255` (hash `printers-section`) must still pass unchanged.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot (frame: header, side list, one category).
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per section card, and none outside the cards.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The `h1` reads "সেটিংস" on desktop; the sticky banner is gone; the school name is the subtitle.
- [ ] `/settings#printers-section` (palette "প্রিন্টার") opens Printing and scrolls to the printers card; `/settings?backup=abc` opens Backup.
- [ ] On phone `/settings` shows only the category list; a category shows the back link + its sections.
- [ ] An ADMIN without `PRINT_TEMPLATE_MANAGE` does not see "প্রিন্টিং" in the list.

## Out of scope
- Redesigning the cards inside each category: School → settings-1b, Academics + Finance → settings-2, Communication → settings-3, Printing / Sign-in → settings-4a, Backup → settings-4b.
- Palette entries per category (e.g. "এসএমএস সেটিংস" → `?section=communication`): filed as a shared request (`action-registry.ts`).
- `PageHeader.title` as a node (for the phone category title): filed as a shared request; until then render the header markup inline (step 5).
- For settings-b: register new or moved sections exactly as the comment at the top of `settings-categories.ts` says. Convert each card to `SettingsSection` the way 1b converts `RegionalSection`. Keep `id="printers-section"` on the printers card and `backupJobId` on `BackupSection`.
- `e2e/keyboard/organisation-structure.spec.ts` (touched by classes-1 and settings-1a) — updated by 31.5.0 (wave-4 close), not by this ticket; re-run it locally and report a break, do not edit it.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| PageHeader title ReactNode or mobileTitle | Refused | — | use the fallback in the ticket (inline PageHeader markup in SchoolSettingsPage.tsx); one page |
| NumberInput / Input numerals mode (type in tenant digits) | Refused | — | use the fallback in the ticket (Latin digits while typing; display stays formatted) — new component; ponytail until a second form needs it |
| palette entries per settings category | Accepted | 31.5.1b | actions settings.communication / settings.finance / settings.backup -> /settings?section=<id> with SETTINGS_CATEGORY_IDS; print.printers keeps #printers-section |

Wave: 9   Lane: settings   Decisions: D9, D15, D16, D25, D29, D30, D32   Depends on: 31.3.8b
