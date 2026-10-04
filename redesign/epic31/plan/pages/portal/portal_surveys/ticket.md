# [31.4.portal-9] Portal surveys — page title always, clearer teacher answer forms

## Goal
`/portal/surveys` always shows its header ("জরিপ" + one line on what it is for), and each survey card shows its privacy and closing lines with icons, a "n teachers left" count and one disclosure per teacher with a two-line label, an "every question is optional" hint, 44 px stars and a right-aligned send button, matching the "after" screenshots.

## What and why
This page lets a guardian or student give the school feedback on each teacher. Today the empty frame (the audit shot) has no title at all, so a parent who lands here sees only "কিছুই অপেক্ষায় নেই" in a dashed box and cannot tell which page this is; the page also has no sidebar entry. With surveys open, the card is `text-sm` text, the teacher label is one squeezed line, and nothing says that questions are optional until a submit fails. The redesign puts the kit header on every loaded frame, gives the card structure and the form a clear hint and footer, and asks the shell for a nav item.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_surveys/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_surveys/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_surveys/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/portal/portal_surveys/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Page top | `PageContainer size="narrow"` + `PageHeader` (title `evaluations:portalSurveys.title` "জরিপ", **New** subtitle) on the loaded **and** the empty frame. Remove `max-w-2xl` and the hand-made `<h1>`. | D16 — the empty frame had no title; D15 |
| 2 | Empty | `EmptyState` with icon `clipboard-check`, existing title + body, no action. | D28 (the dashed box had no icon) |
| 3 | Survey card | Card `p-4 md:p-5`, title `text-h2` (stays `h2`); privacy line with `eye-off` (anonymous) or `user-round` (named) icon; closing line with `calendar-clock` icon, `formatDate` (D5); both `text-text-secondary`. | D17; the two lines read as one paragraph |
| 4 | **New** count | "৩ জন শিক্ষকের উত্তর বাকি" (`text-label text-text-secondary`) above the teacher list, from `survey.pending.length`. | Shows how much is left |
| 5 | Teacher disclosures | One bordered `divide-y` group; each `<details>` summary `min-h-14` with teacher name (`font-medium`) over subject (`text-caption`), a `chevron-down` that turns when open. | The one-line "নাম · বিষয়" label was cramped; the chevron says it opens |
| 6 | **New** hint | First line of each form: "প্রতিটি প্রশ্ন ঐচ্ছিক — তারকা দিন, লিখুন, বা দুটোই। অন্তত একটির উত্তর দিন।" | People only learned the rule from the empty-submit error |
| 7 | Questions | Label `text-label`, stars row (5 × `size-11`, filled `text-status-due-fg fill-current`, empty `text-text-secondary`), Textarea full width. | Kit field spacing; stars had no colour token |
| 8 | Footer | `border-t pt-4`, send button right-aligned on desktop / full width on phone, `send` icon; errors stay `role="alert"` above it as Error text with `circle-alert`. | D29: the only filled button sits in the one open form |

## Mobile behaviour
- One column; the send button is full width and stays the only filled button on screen (other teachers are closed disclosures).
- Stars stay 44 px each (5 × 44 = 220 px, fits 328 px).
- The bottom bar marks "আরও" (31.3.2).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Form shape | dialog per teacher; full-page modal; inline disclosure | keep inline `<details>` | 2–5 questions, no table: D21 says a dialog at most, and the inline form already works with the e2e journey; no behaviour change |
| Where new keys go | `evaluations.json`; `portal.json` | `portal.json` (`surveys.*`) | the portal lane owns `portal`, not `evaluations` (addendum rule); existing keys stay where they are |
| Header on error / pending | show; hide | hide (unchanged) | the file's documented focus contract (`useRouteFocus` falls back to `<main>`), same as every portal page |
| Nav entry | add in this ticket; shared request | shared request | `portal.tsx` / `nav.json` are foundation territory |
| Star colour | primary; amber status token | `text-status-due-fg` | a rating reads as stars, and the token exists in both themes |

## Files
- `client-admin/src/routes/portal/surveys.tsx` — header, empty state, card, count, disclosures, hint, stars colour, footer
- `client-admin/src/routes/portal/surveys.test.tsx` — updated assertions
- `ui/src/i18n/locales/en/portal.json`, `ui/src/i18n/locales/bn/portal.json` — new `surveys.*` keys (also changed by portal-1…8, run earlier)

## Steps
1. Loader: `loadRouteNamespaces('evaluations', 'portal', 'common')`. In `PortalSurveys` add `const { t: tPortal } = useTranslation('portal')`.
2. Loaded and empty frames: wrap in `<PageContainer size="narrow">` with `<PageHeader title={t('portalSurveys.title')} subtitle={tPortal('surveys.subtitle')} />`. Empty: `<EmptyState icon={<ClipboardCheckIcon />} title={t('portalSurveys.empty')} explanation={t('portalSurveys.emptyBody')} />`. Pending / error frames unchanged (no `<h1>`); `SurveysSkeleton` drops `max-w-2xl`.
3. Survey card: `<Card asChild padded><article aria-labelledby={`survey-${survey.id}`}>` → `h2.text-h2` (`id`); `ul.mt-2.space-y-1.text-text-secondary` with `li.flex.items-start.gap-2` rows: icon (`mt-1 size-4 shrink-0`, `EyeOffIcon` when `survey.anonymous`, else `UserRoundIcon`) + the existing note; when `closesAt`, `CalendarClockIcon` + `portalSurveys.closesOn` (keep `formatDate`).
4. Count: `p.mt-4.text-label.text-text-secondary` = `tPortal('surveys.pendingCount', { count: survey.pending.length })`. Then `div.mt-2.divide-y.divide-border-subtle.rounded-md.border.border-border-subtle` holding the `PairForm`s. Pass `teacherName` and `subjectLabel = (bn && pair.subjectNameBn) || pair.subjectName` as two props instead of the joined `label`.
5. `PairForm`: `<details className="group/pair">`; summary `flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-muted` → `span.min-w-0.flex-1` with `span.block.font-medium` teacher + `span.block.text-caption.text-text-secondary` subject, then `ChevronDownIcon` `size-4 shrink-0 text-text-secondary group-open/pair:rotate-180` (`aria-hidden`). Form `flex flex-col gap-4 border-t border-border-subtle p-3 md:p-4`; first child `p.text-caption.text-text-secondary` = `tPortal('surveys.optionalHint')`.
6. Each question: `div.flex.flex-col.gap-1.5`; label `text-label text-text-primary`. `Stars`: buttons `flex size-11 items-center justify-center rounded-md hover:bg-muted` + `n <= value ? 'text-status-due-fg' : 'text-text-secondary'`; icon `size-6` + `fill-current` when filled. Keyboard behaviour and `aria-pressed` unchanged.
7. Errors: the two `role="alert"` lines become `flex items-center gap-1 text-caption text-destructive` with `CircleAlertIcon size-4`. Footer `div.flex.flex-col-reverse.gap-2.border-t.border-border-subtle.pt-4.md:flex-row.md:justify-end` → `<Button type="submit" className="w-full md:w-auto" loading={respond.isPending}>` with `SendIcon` (`size-4`, `aria-hidden`) + label (unchanged keys). Remove `min-h-11` (portal density makes buttons 44 px).
8. Locale (en / bn), under `portal.surveys`: `subtitle` "Tell the school what you think of your teachers." / "শিক্ষকদের সম্পর্কে স্কুলকে আপনার মতামত জানান।"; `pendingCount_one` / `pendingCount_other` "{{count}} teacher left to answer" / "{{count}} teachers left to answer" — bn both "{{count}} জন শিক্ষকের উত্তর বাকি"; `optionalHint` "Every question is optional — give stars, write, or both. Answer at least one." / "প্রতিটি প্রশ্ন ঐচ্ছিক — তারকা দিন, লিখুন, বা দুটোই। অন্তত একটির উত্তর দিন।".

## Tests
- `surveys.test.tsx`: keep the optional-stars, keys 1–5, empty-submit and 409 cases; add: the empty frame has exactly one `h1` "Surveys" and the empty-state title; the loaded frame shows "2 teachers left to answer" for two pending pairs; a summary shows the teacher name and the subject as separate text; the open form shows the optional hint.
- `e2e/journeys/survey.spec.ts` (`/portal/surveys` step: survey title as `h2`, clicking the teacher text opens the form, star button and submit by name) — selectors unchanged; run it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary per view (the send button of the open form).
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] The empty frame shows the "জরিপ" title and subtitle above an `EmptyState` with an icon.
- [ ] Each survey card shows the "n teachers left" count; each teacher row is two lines with a chevron.
- [ ] The open form starts with the "every question is optional" hint.

## Out of scope
- Sidebar / drawer item for `/portal/surveys` — filed in `shared-requests.md` (`portal.tsx`, `nav.json`, `nav-icons.tsx`); the mockup shows it as requested. If refused, the page is reached from the overview card only.
- `-surveys-card.tsx` (overview card) — restyled by portal-1.
- Wording inside `evaluations.json` — owned by the staff lane; no fix needed.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| portal sidebar item /portal/surveys | Accepted | 31.3.2 | after সিলেবাস, label nav:items.portalSurveys "জরিপ", icon clipboard-pen-line, no permission (role-gated), not a bottom-bar cell |

Wave: 9   Lane: portal   Decisions: D5, D15, D16, D17, D21, D28, D29   Depends on: 31.3.8b, 31.4.portal-8
