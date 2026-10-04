# [31.4.print-2a] Print ID cards — one full-page modal with Close

## Goal
Opening "print ID cards" (palette, a list's Print action, or `/print/preview` directly) shows one full-page modal with a big "বন্ধ করুন" on the top right and the actions in a footer — first the picker step, then the preview step — instead of a bare page with no way back; on a phone the same frame shows "open this on a computer" with Close and Copy link.

Split: this ticket (a) is the frame and the picker; [31.4.print-2b] (`ticket-b.md`, runs after a) restyles the preview body.

## What and why
Staff use this to print ID cards: pick students (by name or a whole section) or staff, check the preview, print round by round. Today the picker is a small dialog floating over an empty grey page whose only exit is a tiny X; once you continue, the preview page has **no close or back control at all** (`print-preview.tsx:488`) — the route is chromeless, so there is no sidebar either, and the user is stuck unless they use the browser's back button. The picker also has two filled buttons when a section is chosen, raw browser `<select>`s and a filled/outline toggle for Student/Staff. The user asked by name for a full-page modal with a very visible Close and action buttons, content centred with proper padding. This ticket wraps both steps in `FullPageShell` (D22/D23) and rebuilds the picker inside it.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before — picker | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/before-mobile.webp?raw=true" width="260"> |
| After — picker | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview/mobile.webp?raw=true" width="260"> |
| Before — preview | _not captured_ | _not captured_ |
| After — preview (frame from a, body from b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview_ids/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/print/print_preview_ids/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Picker frame | `FullPageShell title="আইডি কার্ড প্রিন্ট" size="form"`: header Close (X + "বন্ধ করুন", 44 px); footer secondary "বাতিল করুন", primary "n জনকে নিয়ে এগিয়ে যান" (`arrow-right`). The `Dialog` goes. | D22, D23, the user's request |
| 2 | Who | Kit `Tabs` (line): শিক্ষার্থী (`graduation-cap`) / কর্মী (`briefcase`, only with `STAFF_HR_READ`). | Replaces a filled/outline button pair that looked like two primaries |
| 3 | How (students) | **New** radio cards "নাম দিয়ে বাছুন" / "পুরো শাখা" with one-line help. Name mode shows the search card; section mode shows শ্রেণি + শাখা `Select`s. Staff tab has name mode only (no radio). | Today both modes show at once and each brings its own filled button (D29) |
| 4 | Name search | Card "নাম দিয়ে বাছুন" + help; labelled search field with icon; **New** chips of the people already picked ("বাছাই করা ৩ জন:" + removable chips + "সব মুছুন"); results as full-width checkbox rows (name + registration number caption, 44 px); **New** help "প্রথম ২০ জন দেখানো হচ্ছে। না পেলে নাম আরও লিখুন।". | You can see and undo the selection; D25 |
| 5 | Section mode | Two kit `Select`s with labels and "বাছুন" placeholders, full width; the primary becomes "পুরো শাখা নিয়ে এগিয়ে যান" and is disabled until a section is chosen. | D25 (no native select), one primary |
| 6 | Preview frame | `PrintPreview` renders `FullPageShell title="প্রিন্ট প্রিভিউ" size="wide"`; its old `h1` header and bottom button row go. Footer primary = the existing Print action ("প্রিন্ট করুন", `printer`, `busy` while printing, `disabled` = `!canPrint`); secondary "পিছনে" (`arrow-left`) only when the preview was reached from the picker. Close asks before leaving when a round is printed but not confirmed (`dirty`). | D22; today there is no way out |
| 7 | Loading / empty in the frame | Template/printer loading → skeleton inside the shell; no template → `EmptyState` inside the shell and the shell primary = "একটি নমুনা থেকে তৈরি করুন" (EmptyState without its own action). | Close is always there |
| 8 | Phone | Route renders the frame with an `EmptyState` (`monitor`, "এটি কম্পিউটারে খুলুন", body) and primary "লিংক কপি করুন"; no secondary. | Printing needs a big screen (Epic 32 D34) but the user still gets the same Close |
| 9 | Close target | `useCloseFullPage(() => router.history.push(search.from ?? '/'))`. The picker's Continue navigates with `replace: true` and adds `pick: '1'`, so Close from the preview leaves the flow and "পিছনে" returns to the picker. | D22 "closing returns to where the user came from" |

## Mobile behaviour
- Below `md` both steps show only the "open on a computer" EmptyState in the frame (Close in the header, "লিংক কপি করুন" in the footer); the picker and preview are not mounted.
- Header and footer buttons are 44 px at every width.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Where `FullPageShell` lives | route renders it for both steps / each step renders its own | each step (`PrintIdCardModal`, `PrintPreview`) renders it | The primary button needs each step's own state (`picked`, `canPrint`); passing it up would add a render-prop. |
| Mode choice | both modes visible (today) / radio cards | radio cards | One primary button whose label says what will happen (D29). |
| Phone | let the picker run on phone / gate the whole flow | gate inside the frame | The next step needs a printer and a wide preview; picking on a phone and then hitting a wall is worse. |
| Gate component | new phone component in the route / extend `DesktopOnlyGate` | export `useIsWide` + `copyPageLink` from `desktop-only-gate.tsx` | The editor route keeps using `DesktopOnlyGate` unchanged; the preview route reuses the two helpers. |
| Back from preview | none / Close only / "পিছনে" when it came from the picker | "পিছনে" + Close | Lists' Print action opens the preview directly — there is nothing to go back to there. |

## Files
- `client-admin/src/routes/_staff/print/preview.tsx` — phone frame, close, `pick` search param, `onBack`
- `client-admin/src/routes/_staff/print-routes.test.tsx`
- `client-admin/src/components/print/print-id-card-modal.tsx` — full-page picker (keeps its name and props, plus `onClose`)
- `client-admin/src/components/print/print-id-card-modal.test.tsx`
- `client-admin/src/components/print/preview/print-preview.tsx` — wrap in `FullPageShell`, new props `onClose`, `onBack?` (also changed by print-2b, runs later)
- `client-admin/src/components/print/preview/print-preview.test.tsx`
- `client-admin/src/components/print/desktop-only-gate.tsx` — export `useIsWide`, `copyPageLink` (see Out of scope: grant requested)
- `ui/src/i18n/locales/{en,bn}/printPreview.json` — picker keys (also changed by print-2b)
- `ui/src/i18n/locales/{en,bn}/printTemplates.json` — `gate.*` wording (also changed by print-1, runs earlier)
- `e2e/keyboard/print-preview.spec.ts` — no dialog role on the picker

## Steps
1. **Locale `printPreview.json`** (en / bn). Change `picker.cancel` → "Cancel" / "বাতিল করুন"; `print` → "Print" / "প্রিন্ট করুন". Add `picker.modeLabel` "How do you want to choose?" / "কীভাবে বাছবেন?"; `picker.modeNames` "Choose by name" / "নাম দিয়ে বাছুন"; `picker.modeNamesHelp` "A few cards — search and tick" / "কয়েকজনের কার্ড — খুঁজে টিক দিন"; `picker.modeSection` "Whole section" / "পুরো শাখা"; `picker.modeSectionHelp` "Every student in one section" / "একটি শাখার সব শিক্ষার্থীর কার্ড"; `picker.namesTitle` "Choose by name" / "নাম দিয়ে বাছুন"; `picker.namesHelp` "Search by name or roll, then tick whose card you need." / "নাম বা রোল লিখে খুঁজুন, তারপর যাদের কার্ড লাগবে তাদের টিক দিন।"; `picker.pickedLabel_one/_other` "{{count}} chosen:" / "বাছাই করা {{count}} জন:"; `picker.removePicked` "Remove {{name}}" / "{{name}} সরান"; `picker.clearPicked` "Clear all" / "সব মুছুন"; `picker.limitHelp` "Showing the first 20. Type more of the name if you can't find someone." / "প্রথম ২০ জন দেখানো হচ্ছে। না পেলে নাম আরও লিখুন।"; `picker.sectionTitle` "Whole section" / "পুরো শাখা"; `picker.continueSection` "Continue with the whole section" / "পুরো শাখা নিয়ে এগিয়ে যান"; `back` "Back" / "পিছনে". Delete `picker.wholeSection`, `picker.printSection` and `picker.selected_*` (the chips row replaces it); `picker.results` stays (list `aria-label`). `picker.who` becomes the tab list `aria-label`.
2. **Locale `printTemplates.json`.** `gate.title` → "Open this on a computer" / "এটি কম্পিউটারে খুলুন"; `gate.body` → "Designing and printing need a big screen. Copy the link and open it on a computer." / "নকশা আর প্রিন্টের জন্য বড় পর্দা লাগে। নিচের বোতামে লিংক কপি করে কম্পিউটারে খুলুন।"; `gate.copy` → "Copy link" / "লিংক কপি করুন".
3. **`desktop-only-gate.tsx`.** `export` the existing `useIsWide`; move the body of `copyLink` into `export async function copyPageLink(t: TFunction): Promise<void>` and call it from the component. No visual change to `DesktopOnlyGate`.
4. **`preview.tsx`.** Add `pick: z.literal('1').optional().catch(undefined)` to the schema. `const close = useCloseFullPage(() => router.history.push(search.from ?? '/'))`. `const wide = useIsWide()`. If `!wide`: return `<FullPageShell title={…picker or preview title…} onClose={close} primary={{ label: tT('gate.copy'), onClick: () => void copyPageLink(tT) }}><EmptyState icon={<Monitor />} title={tT('gate.title')} explanation={tT('gate.body')} /></FullPageShell>` (`tT` = `useTranslation('printTemplates').t`). Stop using `DesktopOnlyGate` in this file. Picker: `<PrintIdCardModal initialType={…} onClose={close} onConfirm={(choice) => void navigate({ replace: true, search: (prev) => ({ ...prev, pick: '1', … }) })} />` (drop `open`/`onCancel`). Section pending: render the skeleton inside `FullPageShell title={t('title')} size="wide" onClose={close} primary={{ label: t('print'), onClick: () => undefined, disabled: true }}`. `PrintPreview` gets `onClose={close}` and, when `search.pick === '1'`, `onBack={() => void navigate({ replace: true, search: ({ ids: _i, class_section_id: _c, pick: _p, ...rest }) => rest })}`.
5. **`print-id-card-modal.tsx`.** Props: `{ initialType, onClose, onConfirm }`. Root = `FullPageShell title={t('picker.title')} size="form" onClose={onClose} secondary={{ label: t('picker.cancel'), onClick: onClose }} primary={…}` with `dirty={picked.size > 0 || sectionId !== ''}`. State: add `mode: 'names' | 'section'` (default `'names'`; forced `'names'` on the Staff tab). Body (sections spaced by the shell's `space-y-6`):
   - Card 1: `Tabs value={type} onValueChange={switchType}` with the two triggers (icons `GraduationCap`, `Briefcase`); for STUDENT a `fieldset` (`legend text-label`) with two radio cards in `mt-1.5 grid gap-2 md:grid-cols-2` — each a `label` `flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3` (selected `border-primary bg-secondary`, else `border-border-subtle bg-surface hover:bg-muted`) wrapping a visually hidden radio, a 20 px ring dot, title `font-medium` and help `text-caption text-text-secondary`. Use `RadioGroup` from `@biddaloy/ui` if it exists, else native `input type="radio" className="sr-only"`.
   - Names mode Card: `h2 text-h2` + help; search Field (label `picker.search`, icon inside `ps-10`); picked chips row (FilterBar chip classes; each chip `aria-label={t('picker.removePicked', { name })}` removes it; "সব মুছুন" clears); results `ul` `mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle` with rows `label flex min-h-11 items-center gap-3 px-3 hover:bg-muted md:min-h-10` = `Checkbox` + name (`font-medium`) + caption `registration_number` (`text-caption text-text-secondary`, students only — staff rows show the name alone); `p mt-2 text-caption text-text-secondary` `picker.limitHelp` when `rows.length === PICK_LIMIT`.
   - Section mode Card: `h2` `picker.sectionTitle`; `grid gap-4 md:grid-cols-2` with two `Select`s (labels `picker.class` / `picker.section`, placeholders `picker.classPlaceholder` / `picker.sectionPlaceholder`); section disabled until a class is chosen.
   - Primary: names mode `{ label: t('picker.continue', { count: picked.size }), disabled: picked.size === 0, onClick: () => onConfirm({ subjectType: type, ids: [...picked.keys()].join(',') }) }`; section mode `{ label: t('picker.continueSection'), disabled: sectionId === '', onClick: () => onConfirm({ subjectType: 'STUDENT', classSectionId: sectionId }) }`.
6. **`print-preview.tsx` (frame only).** Props: add `onClose: () => void` and `onBack?: () => void`. Every return (loading, no template, normal) is wrapped in `<FullPageShell title={t('title')} size="wide" onClose={onClose} dirty={started && confirmed < batches.length} {...(onBack ? { secondary: { label: t('back'), onClick: onBack } } : {})} primary={…}>`. Normal: primary `{ label: printing ? t('printing') : t('print'), onClick: print, busy: printing, disabled: !canPrint }`; delete the old `<header>` with the `h1` and the bottom `div` holding the Print button (keep the `locked` text: move it right above the cards as `p className="text-text-secondary"`, b restyles). No template: primary = `{ label: t('noTemplate.action'), onClick: onCreateTemplate }` and `EmptyState` without `action`. Loading: primary disabled. Keep `data-print-preview` on the body wrapper and the Enter-to-print handler.
7. Run `yarn test:frontend run components/print print-routes`, then `graphify update .`.

## Tests
- `print-id-card-modal.test.tsx`: h1 "Print ID cards" and a "Close" button that calls `onClose`; Student/Staff are tabs (Staff hidden without `STAFF_HR_READ`, keep that test); picking two people shows two chips and the primary "Continue with 2"; removing a chip unticks the row; section mode shows two comboboxes (no `<select>` in the DOM) and the single primary "Continue with the whole section" calling `onConfirm({ classSectionId })`; never two filled buttons.
- `print-preview.test.tsx`: the h1 is "Print preview"; "Close" calls `onClose`; "Print" sits in the footer and keeps its enable rules; "Back" renders only when `onBack` is passed; no-template state shows the create action as the shell primary.
- `print-routes.test.tsx`: under 768 px the preview route shows "Open this on a computer" + "Copy link" + "Close" and does not mount the picker or the preview; update the editor gate test to the new title text; Continue in the picker replaces history (Close then lands on `from`).
- `e2e/keyboard/print-preview.spec.ts`: drop `expect(page.getByRole('dialog')).toBeVisible()`; the heading, search label, continue button and printer/print names are unchanged `t()` lookups.
- `e2e/journeys/print-id-cards.spec.ts`, `exam-controller-role.spec.ts`, `office-staff-role.spec.ts`: no change expected (they read `printPreview.*` / `printTemplates.gate.title` through `t()`); run them.

## Acceptance
- [ ] Desktop at 1440 px matches the "after — picker" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] "বন্ধ করুন" (X + word) is visible top right on the picker, the preview, the loading and the no-template states, and on phone.
- [ ] From a list's Print action, Close returns to that list; from the palette, Close returns to the page the palette was opened on.
- [ ] Esc on the preview after printing a round but before confirming asks before leaving.
- [ ] No native `<select>` on the picker.

## Out of scope
- Requested in `shared-requests.md`: grant `client-admin/src/components/print/desktop-only-gate.tsx` to the print lane (only print routes import it). If refused, step 3 is skipped and phone keeps today's bare gate page around the frame.
- Preview body layout (settings card, rounds, pre-flight, card grid, "did all print?" dialog) — print-2b.
- The command-palette entries keep their labels (`action-registry.ts` is foundation-owned).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| grant desktop-only-gate.tsx to the print lane (export useIsWide, copyPageLink) | Accepted | — | granted to print-2a: no foundation ticket touches client-admin/src/components/print/desktop-only-gate.tsx |

Wave: 9   Lane: print   Decisions: D9, D15, D21, D22, D23, D25, D28, D29   Depends on: 31.3.8b, 31.4.print-1
