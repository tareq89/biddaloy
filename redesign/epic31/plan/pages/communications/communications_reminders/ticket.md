# [31.4.communications-2a] Fee reminders — readable placeholders, preview then send

## Goal
`/communications/reminders` (single-student mode) matches the "after" screenshots: standard page header, student / guardians / message / preview cards in reading order, placeholders shown as Bangla words, one filled button that moves from "Preview" to "Send", and no backend text on screen.
Split: this ticket is the single-student page plus the helpers it shares with the bulk wizard; `ticket-b.md` (communications-2b, runs after this one) turns the bulk wizard into a full-page modal.

## What and why
The page reminds one student's guardians about unpaid fees: pick the student, choose guardians, write the message, preview exactly who gets what, then send. Today it builds its own narrow column with a larger title than other pages, shows raw tokens like `{{student_name}}` on buttons and in the message, puts Preview and a disabled Send side by side above the preview they depend on, prints phone numbers raw and shows the server's English 400 text. The redesign follows the reading order top to bottom, shows placeholders as words, keeps exactly one filled button for the next step, and translates every message.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders/mobile.webp?raw=true" width="260"> |
| After (bulk, ticket-b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders_bulk/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/communications/communications_reminders_bulk/mobile.webp?raw=true" width="260"> |

The "before" shot was taken as an accountant and shows the red "no permission" toast — that is B8, fixed by 31.3.6, not here.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Frame (form and result state) | `PageContainer size="narrow"` + `PageHeader` title "ফি রিমাইন্ডার", subtitle, one outline action "একসাথে অনেককে রিমাইন্ডার" (`users` icon). Drop the hand-made wrapper, `text-2xl` `h1` and `p-4`. | D15, D16 |
| 2 | Student card | Card "শিক্ষার্থী": `SelectedStudentRow` (from communications-1) + facts `dl` (বকেয়া পরিমাণ, শেষ রিমাইন্ডার "১২ই সেপ্টেম্বর, ২০২৬ · এসএমএস"). | Facts were muted inline "label: value" text |
| 3 | Guardians card | Card "যাদের মনে করানো হবে": checkbox rows `min-h-11` in a bordered list; second line "পছন্দ: এসএমএস · 01711-000004" (`formatPhone`, or email, or "নম্বর নেই"). | 44 px targets, D8 |
| 4 | Placeholders | **New** display form: the message holds `{শিক্ষার্থীর নাম}` instead of `{{student_name}}`; insert buttons show the word with a `plus` icon; converted to server tokens before preview/send. | D9 — no raw keys on screen |
| 5 | Message card | "বার্তা" textarea, counter + estimate note, "বার্তায় বসান" buttons + help, "কীভাবে পাঠাবেন" select at half width on desktop, WhatsApp fields. | Grouped by what they change |
| 6 | Preview → Send | Until a current preview exists, the message card footer holds the one filled "প্রাপকদের প্রিভিউ করুন". After it, that button turns outline "আবার প্রিভিউ করুন" and a **New** Preview card appears below with the recipients, the skipped list and, in its footer, the filled "২ জনকে রিমাইন্ডার পাঠান". | One obvious next action; Send sits under what it sends |
| 7 | Recipient list (shared with bulk) | Table → list: name + "মাধ্যম · contact" line, the rendered message in a `bg-muted` box, SMS count under it; skipped rows show name + translated reason. Phones via `formatPhone`. | Reads the same on phone; B22 (`recipient-list:69`) |
| 8 | Unknown skip reason | Falls back to "অন্য কারণে বাদ পড়েছে" instead of the raw wire string. | D9 |
| 9 | Errors | 400 on preview/send shows a translated sentence (`reminders.previewInvalid` / `reminders.sendInvalid`) instead of `error.message`. | D9 |
| 10 | Result state | Same header; Card "রিমাইন্ডার পাঠানো হয়েছে" with sent rows + `StatusBadge` and skipped rows; primary "আরেকজনকে রিমাইন্ডার পাঠান" (was "শিক্ষার্থী পরিবর্তন করুন"). | Plain label for the action |

## Mobile behaviour
- One column; the header's outline button is full width under the title (it is the only header action, so it is not hidden in "More").
- Insert buttons wrap two per row; all controls `h-11`.
- The Send button is full width at the bottom of the Preview card, the "cannot be recalled" note under it.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| How to hide `{{student_name}}` | rich editor with chips / localized `{word}` tokens converted on send / leave raw | localized `{word}` tokens, converted in `template-placeholders.ts` | No new dependency; plain textarea keeps working; server contract unchanged |
| Preview and Send buttons | side by side / swap which is filled | swap: Preview filled until a current preview exists, then Send filled in the Preview card | D29 one filled per view; order matches the flow |
| Header action on phone | move into "More" / keep visible | keep visible as outline `flex-1` | It is the only header action; a menu with one item hides it for nothing |
| Recipient list | DataTable / plain list | plain list inside the Preview card | Each row carries a long message body; a list reads the same at both sizes |
| Width | wide / narrow | narrow | D15: form page |

## Files
- `client-admin/src/routes/_staff/communications/reminders.tsx` — frame, cards, button swap, errors, result state (the `mode=bulk` branch is left for 2b)
- `client-admin/src/routes/_staff/communications/reminders.test.tsx` — updated
- `client-admin/src/routes/_staff/communications/-shared/selected-student-row.tsx` — reused, no change expected (also changed by communications-1, runs earlier)
- `client-admin/src/routes/_staff/communications/-shared/template-placeholders.ts` — display ↔ server conversion
- `client-admin/src/routes/_staff/communications/-shared/template-placeholders.test.ts` — conversion tests
- `client-admin/src/routes/_staff/communications/-shared/placeholder-buttons.tsx` — **New**, used here and in 2b
- `client-admin/src/routes/_staff/communications/-shared/recipient-list.tsx` — list layout, `formatPhone`
- `client-admin/src/routes/_staff/communications/-shared/skip-reason.ts` + `skip-reason.test.ts` — unknown fallback key
- `ui/src/i18n/locales/en/communications.json`, `ui/src/i18n/locales/bn/communications.json` (also changed by communications-1, runs earlier)

## Steps
1. **`template-placeholders.ts`.** Keep `SUPPORTED_PLACEHOLDERS` and `findUnsupportedPlaceholders`. Add:
   ```ts
   export const PLACEHOLDER_NAMES = ['student_name', 'guardian_name', 'due_amount', 'due_month'] as const;
   export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];
   export type PlaceholderLabels = Record<PlaceholderName, string>;
   /** `{শিক্ষার্থীর নাম}` → `{{student_name}}`; existing `{{…}}` tokens pass through. */
   export function toServerTemplate(display: string, labels: PlaceholderLabels): string;
   /** `{{ student_name }}` → `{শিক্ষার্থীর নাম}` for the four supported names; anything else unchanged. */
   export function toDisplayTemplate(server: string, labels: PlaceholderLabels): string;
   /** Single-brace `{…}` left in a display template after conversion = a word we do not know. */
   export function findUnknownLabels(display: string, labels: PlaceholderLabels): string[];
   ```
   `toServerTemplate` replaces each exact `{${labels[name]}}` with `{{${name}}}` (escape the label for the RegExp). `findUnknownLabels` runs `toServerTemplate` first, then collects matches of `/(?<!\{)\{([^{}]+)\}(?!\})/g`. Labels come from `t('placeholders.<name>')` in the component (`usePlaceholderLabels()` helper exported from the same file: `const { t } = useTranslation('communications'); return useMemo(() => Object.fromEntries(PLACEHOLDER_NAMES.map(n => [n, t(`placeholders.${n}`)])), [t])`).
2. **`placeholder-buttons.tsx` (New).** `PlaceholderButtons({ labels, onInsert })`: a Field with label `t('reminders.placeholdersLabel')` ("বার্তায় বসান"), `div role="group" className="flex flex-wrap gap-2"` of `Button variant="outline"` (`Plus` icon `size-4` + the label, `aria-label={t('reminders.insertPlaceholder', { token: label })}`) calling `onInsert(`{${label}}`)`, then `<p className="text-caption text-text-secondary">{t('reminders.placeholderHelp')}</p>`.
3. **Reminders state.** `template` state now holds the display form. `const labels = usePlaceholderLabels(); const serverTemplate = toServerTemplate(template, labels);` Use `serverTemplate` in `fingerprint`, `buildInput().message_template` and `findUnsupportedPlaceholders`. Unknown = `[...findUnknownLabels(template, labels), ...findUnsupportedPlaceholders(serverTemplate)]`; show it with `t('reminders.unknownPlaceholder', { token: unknown.join(', ') })` (the `supported` param goes away). `insertPlaceholder(token)` appends as today.
4. **Frame.** Wrap `SingleReminderForm` (both returns) in `<PageContainer size="narrow">` with `<PageHeader title={t('reminders.title')} subtitle={t('reminders.description')} actions={[{ id: 'bulk', label: t('bulk.entryAction'), icon: <Users />, priority: 'secondary', onClick: () => void navigate({ to: '/communications/reminders', search: { mode: 'bulk' } }) }]} />`. Remove `mx-auto`, `max-w-3xl`, `p-4`, `text-2xl`.
5. **Student card** (`Card padded`, `h2.text-h2` `t('reminders.studentSectionTitle')`). No student: `StudentSearch` as today. Picked: `SelectedStudentRow` (`changeLabel={t('send.clearStudent')}`, `onChange={handleChangeStudent}`), then `<dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">` with `dt.text-caption.text-text-secondary` / `dd.font-medium` pairs: balance (`tabular-nums`, `formatServerAmount`) and last reminder (`t('reminders.lastReminderValue', { date: formatDate(…), medium })` or `lastReminderNever`).
6. **Guardians card** (`h2` `t('reminders.guardiansLabel')`). Bordered list `mt-4 divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle`; each guardian is a `<label>` row `flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-muted` with `Checkbox` + two lines: `guardianOptionLabel` and `text-caption text-text-secondary` `t('reminders.guardianContact', { medium: t(`mediums.${g.preferred_communication}`), address })` where `address = preferred EMAIL ? g.email : g.phone ? formatPhone(g.phone, config) : null`, `null → t('reminders.guardianNoAddress')`. No guardians: kit error text (`CircleAlert` + `text-caption text-destructive`, `role="alert"`).
7. **Message card** (`h2` `t('reminders.messageSectionTitle')`, `mt-4 grid gap-4`): Textarea (label `reminders.messageLabel`, required mark, `rows={4}`), then when `smsInPlay` `SmsSegmentCounter` and `p.text-caption.text-text-secondary` `reminders.smsEstimateNote`; `PlaceholderButtons`; medium Select in a Field `md:w-1/2` with `SelectTrigger className="w-full"`; `WhatsappTemplateFields` when WhatsApp. Footer `mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-end`:
   - `previewMatchesInputs === false` → left text (`acceptedPreview !== null` → `text-status-due-fg` `previewStale`, else `text-text-secondary` `sendHint`), right `<Button disabled={!canPreview} loading={preview.isPending}>` (filled) `previewAction`/`previewing`.
   - `previewMatchesInputs === true` → right only `<Button variant="outline"><RefreshCw />{t('reminders.previewAgain')}</Button>`.
   - Errors under the footer: preview 400 → `t('reminders.previewInvalid')`, other → `previewErrorMessage`; send 400 → `t('reminders.sendInvalid')`, other → `errorMessage`. Delete both `error.message` branches.
8. **Preview card** (only when `previewMatchesInputs`): header `flex flex-wrap items-center justify-between gap-2` with `h2` `t('reminders.previewTitle')` + `<StatusBadge tone="success" label={t('reminders.previewFresh')} />`; then `<RecipientList …/>`; footer `mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between` with `p.text-text-secondary` `t('reminders.irreversibleNote')` and, when recipients > 0, `<Button disabled={!canSend} loading={send.isPending}><Send />{t('reminders.sendToCount', { count: recipients.length })}</Button>`.
9. **`recipient-list.tsx`.** Replace both tables. Recipients: `h3.text-h3.mt-4` title, `ul.divide-y.divide-border-subtle`, each `li.py-3`: `div.flex flex-wrap items-baseline justify-between gap-x-3` with `p.font-medium` guardian name and `p.text-text-secondary` `${t(`mediums.${medium}`)} · ${contact}` (`contact = medium === 'EMAIL' ? address : formatPhone(address, config)`); subject (email) as `p.mt-2.font-medium`; body `p.mt-2 whitespace-pre-wrap rounded-md bg-muted p-3`; SMS count `SmsSegmentCounter live={false}` (`mt-1`). Empty recipients keep the `role="alert"` line with kit error-text classes. Skipped: same `h3`, rows `li.flex flex-col gap-0.5 py-3 md:flex-row md:justify-between md:gap-4` with name (`guardian_name ?? '—'`) and `p.text-text-secondary` `t(skipReasonKey(reason))`.
10. **`skip-reason.ts`.** `skipReasonKey(reason): string` returns `'skipReasons.unknown'` for an unrecognised reason (no more `undefined`). Callers in this ticket drop their `?? reason` / `: entry.reason` fallbacks (`reminders.tsx:328-332`, `recipient-list.tsx`). The bulk wizard and `$batchId.tsx` keep compiling (their `!== undefined` checks become always-true) and are tidied in 2b / communications-3.
11. **Result state.** Header as step 4; `Card padded` with `h2` `reminders.resultTitle`; `h3.text-h3` sent title + `ul.divide-y` rows `flex min-h-11 items-center justify-between gap-2` (name · medium, `StatusBadge domain="communication"`); skipped title + rows with translated reasons; footer `mt-5 flex justify-end border-t border-border-subtle pt-4` with primary `t('reminders.startAnother')` → `handleStartAnother`.
12. **Locale keys** (en + bn):

| Key | en | bn |
|---|---|---|
| `placeholders.student_name` (new) | Student name | শিক্ষার্থীর নাম |
| `placeholders.guardian_name` (new) | Guardian name | অভিভাবকের নাম |
| `placeholders.due_amount` (new) | Amount due | বকেয়ার পরিমাণ |
| `placeholders.due_month` (new) | Due month | বকেয়ার মাস |
| `reminders.description` (changed) | Remind one student's guardians about unpaid fees. | একজন শিক্ষার্থীর অভিভাবকদের বকেয়ার কথা মনে করিয়ে দিন। |
| `reminders.guardiansLabel` (changed) | Who will be reminded | যাদের মনে করানো হবে |
| `reminders.guardianContact` (new) | Prefers {{medium}} · {{address}} | পছন্দ: {{medium}} · {{address}} |
| `reminders.guardianNoAddress` (new) | no number | নম্বর নেই |
| `reminders.lastReminderValue` (changed) | {{date}} · {{medium}} | {{date}} · {{medium}} |
| `reminders.messageSectionTitle` (new) | Message | বার্তা |
| `reminders.messageLabel` (changed) | Message | বার্তা |
| `reminders.placeholdersLabel` (changed) | Insert into message | বার্তায় বসান |
| `reminders.insertPlaceholder` (changed) | Insert {{token}} | {{token}} বসান |
| `reminders.placeholderHelp` (new) | Words in {curly brackets} are replaced with each guardian's real name and amount. | বাঁকা বন্ধনীর ভেতরের অংশ প্রত্যেক অভিভাবকের জন্য আসল নাম ও টাকায় বদলে যাবে। |
| `reminders.unknownPlaceholder` (changed) | {{token}} isn't recognised. Use the buttons below to insert a name or amount. | {{token}} চেনা যায়নি। নিচের বোতাম দিয়ে নাম বা টাকা বসান। |
| `reminders.mediumOverrideLabel` (changed) | Send by | কীভাবে পাঠাবেন |
| `reminders.smsEstimateNote` (changed) | Estimate — the exact count shows in the preview once names and amounts are filled in. | আনুমানিক — নাম ও টাকা বসার পর সঠিক হিসাব প্রিভিউতে দেখা যাবে। |
| `reminders.previewAgain` (new) | Preview again | আবার প্রিভিউ করুন |
| `reminders.previewTitle` (new) | Preview | প্রিভিউ |
| `reminders.previewFresh` (new) | Up to date | হালনাগাদ |
| `reminders.irreversibleNote` (new) | A sent message cannot be recalled. | পাঠানো বার্তা আর ফেরত আনা যায় না। |
| `reminders.sendToCount_one` / `_other` (new) | Send reminder to {{count}} person / Send reminder to {{count}} people | {{count}} জনকে রিমাইন্ডার পাঠান |
| `reminders.previewInvalid` (new) | The preview could not be made — check the student, guardians and message. | প্রিভিউ দেখানো যায়নি — শিক্ষার্থী, অভিভাবক ও বার্তা আবার দেখুন। |
| `reminders.sendInvalid` (new) | The reminder was not sent — check the guardians and message, then preview again. | রিমাইন্ডার পাঠানো যায়নি — অভিভাবক ও বার্তা দেখে আবার প্রিভিউ করুন। |
| `reminders.startAnother` (new) | Remind another student | আরেকজনকে রিমাইন্ডার পাঠান |
| `skipReasons.unknown` (new) | Skipped for another reason | অন্য কারণে বাদ পড়েছে |
| `bulk.entryAction` (changed) | Remind many at once | একসাথে অনেককে রিমাইন্ডার |

## Tests
- `template-placeholders.test.ts`: `toServerTemplate('প্রিয় {অভিভাবকের নাম}', bnLabels) === 'প্রিয় {{guardian_name}}'`; `{{student_name}}` typed directly passes through; `toDisplayTemplate('{{ due_amount }}', bnLabels) === '{বকেয়ার পরিমাণ}'`; `findUnknownLabels('{ভুল}', bnLabels)` returns `['ভুল']`; a round trip is stable.
- `skip-reason.test.ts`: unknown reason returns `'skipReasons.unknown'`.
- `reminders.test.tsx`: insert buttons show "Student name" (not `{{student_name}}`) and clicking one puts `{Student name}` in the textarea; the preview request body carries `{{student_name}}`; before preview the only filled button is "Preview recipients"; after a preview "Preview again" is outline and "Send reminder to 2 people" is the filled one; editing the message hides the Preview card and shows the stale hint; a 400 shows the translated sentence, never the server text; phones in the recipient list read `01711-000004`.
- E2E: none reference this page.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No `{{…}}` token is visible anywhere on the page.
- [ ] The filled button is "প্রাপকদের প্রিভিউ করুন" before a preview and "n জনকে রিমাইন্ডার পাঠান" (inside the Preview card) after it.
- [ ] Guardian rows and recipient rows show phones as `01711-000004`.
- [ ] Cards appear in the order শিক্ষার্থী → যাদের মনে করানো হবে → বার্তা → প্রিভিউ.

## Out of scope
- B8 "no permission" toast on open — 31.3.6.
- The bulk wizard (`?mode=bulk`) — `ticket-b.md`.
- `SmsSegmentCounter` and the estimate note render on two lines; the mockup shows them as one line — either is acceptable.
- No shared requests filed for this ticket.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| WizardShell headless / full-page mode | Refused | — | use the fallback in the ticket (own step row with useWizardShellStep inside FullPageShell); one page, new shell mode |

Wave: 9   Lane: communications   Decisions: D5, D6, D8, D9, D15, D16, D17, D25, D27, D29   Depends on: 31.3.8b, 31.4.communications-1
