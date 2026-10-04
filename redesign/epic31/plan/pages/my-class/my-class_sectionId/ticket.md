# [31.4.my-class-2] My class section page — phone-first cards, kit header, localised numbers

## Goal
`/my-class/$sectionId` shows the kit header (crumbs, h1 = section name, subtitle with role and today's date, the one primary "আজকের উপস্থিতি নিন") above six kit cards in one column on phone and three columns on desktop, with every number, phone and status in the kit's formats.

## What and why
This is the class teacher's morning screen, mostly opened on a phone in the classroom: take today's attendance, see who is absent or on a streak, and glance at dues, homework, results and the roster. Today the h1 ("আমার শ্রেণি · সপ্তম শ্রেণি-ক") does not match the crumb, numbers, percentages, roll numbers and day counts print in Latin digits, phone numbers are raw and their links are 24 px tall, statuses are plain text, card titles and errors use old token names, and on desktop six cards stack in one 1150 px column. The redesign keeps the cards, their order and their data, and only changes the frame, the formats and the layout.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | _not captured_ | _not captured_ |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/my-class/my-class_sectionId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/my-class/my-class_sectionId/mobile.webp?raw=true" width="260"> |

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Container | `<PageContainer>` around every branch; the `p-4` wrappers go. | D15 |
| 2 | Header | PageHeader markup (written inline, see Decisions): h1 = the section's crumb text "সপ্তম শ্রেণি-ক" (was "আমার শ্রেণি · সপ্তম শ্রেণি-ক"); **New** subtitle "শ্রেণি শিক্ষক · আজ ৪ঠা অক্টোবর, ২০২৬"; the existing "আজকের উপস্থিতি নিন" link becomes the header primary (`clipboard-check` icon), full width on phone, right-aligned on desktop. Focus still lands on it on load. | D16, D32, D5 |
| 3 | Layout | Cards in `grid items-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3`, same order as today (absent today, flags, dues, homework, results, students). | D17; one long column at 1440 px |
| 4 | Card frame | Kit Card (`rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5`), title `text-h2`, sub-group titles `text-label text-text-secondary`, rows `divide-y divide-border-subtle py-2`. Old tokens (`text-sm`, `text-muted-foreground`, `text-base font-semibold`) go. | D17 |
| 5 | Card error / loading | Per-card error: translated sentence + outline "আবার চেষ্টা করুন" with `rotate-ccw` at kit height (was `size="sm"`, 32 px on phone). Loading: `h-3` skeleton bars. | D28, 44 px targets |
| 6 | Absent today | **New** StatusBadge next to the title: danger "৩ জন" when someone is absent, warning "নেওয়া হয়নি" when the register is not taken. Rows: name `font-medium`, "রোল ৭" secondary. | D27, "can I see the state" |
| 7 | Flags | Each row: name + "রোল ১২" (caption) and a StatusBadge with the day count — absent streak danger, late streak warning, present streak success. Group titles stay the existing sentences. | D27, D6 |
| 8 | Dues | The summary sentence becomes two **New** stats: "মোট বকেয়া ৳১২,৫০০.০০" and "শিক্ষার্থী ৮ জন" (`text-h2 tabular-nums`); top-5 rows with the amount `tabular-nums`. "সব দেখুন" still only with `FEE_COLLECT`. | D6, scan at a glance |
| 9 | Homework | Three stats (মোট / সম্পন্ন / অসম্পন্ন) as `text-h2` numbers; অসম্পন্ন in `text-status-overdue-fg` when > 0. Label "বাড়ির কাজ" → "মোট" (it repeated the card title). | D6 |
| 10 | Results | Exam name as the card's subtitle; গড় নম্বর and পাসের হার as stats via `formatNumber` ("৬৮.৪", "৮৭%"); failed list as rows with roll. | D6 (was `87%` Latin) |
| 11 | Students | Guardian phone shown with `formatPhone` ("01711-000004") in a 44 px link with a `phone` icon (was a 24 px underlined number); "ফোন নেই" in secondary text. | D8, 44 px targets |
| 12 | "সব দেখুন" | Standalone ghost link `h-11 md:h-8` with `chevron-right`, no underline (was a 24 px underlined link). | D29 |
| 13 | Page error / pending | Page-level error message **New** "এই শাখার তথ্য আনা যায়নি।" (was the card sentence); `RoutePending` label translated (was English "Loading"). | D28, D9 |

## Mobile behaviour
- Crumbs, h1, subtitle, then the primary button full width — visible without scrolling.
- One column of cards in the same order; card padding 16 px.
- Phone links and "সব দেখুন" are 44 px tall; rows of the roster are `py-1` around the 44 px link.
- Bottom bar: the page is in no TEACHER cell, so "আরও" is marked (shell behaviour).

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Header component | `PageHeader` with `actions` / inline PageHeader markup | inline markup, same classes as `PageHeader` | The primary is a router `Link` that must take focus on load (`e2e/keyboard/my-class.spec.ts`, Epic 47 D13); `PageAction` has no `to` (REFUSED, RESOLUTIONS-ui fees_fines) and no ref. Same fallback the settings ticket uses. |
| h1 text | keep "আমার শ্রেণি · …" / section name | section name, same string as the crumb | D16: h1 = last crumb. The crumb comes from `use-breadcrumbs.ts` (`${class_name}-${section_name}`). |
| Primary label after attendance is taken | change to "উপস্থিতি দেখুন" / keep | keep | The register page itself handles view vs edit; the Absent-today badge already shows the state. |
| Card order on desktop | today-first span 2 columns / plain grid | plain 3-column grid, today's order | Fewer special cases; the two morning cards (absent, flags) are still first. |
| Numbers inside i18n strings | `{{count}}` raw / pre-formatted var | pass `formatNumber(...)` as a separate var (`n`, `roll`) | i18next does not apply tenant numerals (D6); `count` stays for plural rules. |
| Split the ticket | a/b / one | one | 6 files, all inside this route folder + namespace. |

## Files
- `client-admin/src/routes/_staff/my-class/$sectionId.tsx` — container, inline header, grid, page states, pending label
- `client-admin/src/routes/_staff/my-class/-cards.tsx` — card frame, badges, stats, formats, links
- `client-admin/src/routes/_staff/my-class/$sectionId.test.tsx` — update
- `ui/src/i18n/locales/bn/myClass.json` — keys below (also changed by my-class-1, runs earlier)
- `ui/src/i18n/locales/en/myClass.json` — keys below (also changed by my-class-1, runs earlier)
- `e2e/journeys/my-class.spec.ts` — h1 name

## Steps
1. **Route (`$sectionId.tsx`).**
   - `pendingComponent`: a `SectionPending` component with `useTranslation('myClass')` → `<RoutePending variant="detail" label={t('loading')} />` (key added by my-class-1). Use it for the in-component `isPending` branch too.
   - Error branch: `<PageContainer><ErrorState message={t('sectionLoadError')} retryLabel={t('retry')} onRetry={…} /></PageContainer>`.
   - Main return:
     ```tsx
     <PageContainer>
       <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
         <div className="min-w-0">
           <h1 className="text-h1">{`${section.class_name}-${section.section_name}`}</h1>
           <p className="mt-0.5 truncate text-text-secondary">
             {t('subtitle', { role: t(`roles.${section.assignment_type}`), date: formatDate(new Date(), region) })}
           </p>
         </div>
         <div className="flex shrink-0 items-center gap-2">
           <Button asChild className="flex-1 md:flex-none">
             <Link ref={attendanceRef} to="/attendance/$sectionId" params={{ sectionId }} search={{ date: todayIso() }}>
               <ClipboardCheckIcon aria-hidden="true" />{t('takeAttendance')}
             </Link>
           </Button>
         </div>
       </header>
       <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
         {/* the six cards, same order and props as today */}
       </div>
     </PageContainer>
     ```
     Drop `size="lg"` on the Button (kit height `h-11 md:h-8` comes from the base). Breadcrumbs are rendered by the layout above the header. The h1 string must stay identical to `myClassSection.getName` in `client-admin/src/use-breadcrumbs.ts`; if the shared request changing it to `– ` lands first, use that form here too. `region = useRegionConfig()`, `formatDate` from `@biddaloy/ui/utils` (long form after 31.2.1a). Keep the focus `useEffect`.
2. **`CardFrame` (`-cards.tsx`).** Add an optional `badge?: ReactNode` and `subtitle?: string`. Markup:
   ```tsx
   <Card asChild padded>   {/* Card's padding gives p-4 md:p-5 */}
     <section aria-labelledby={id}>
       <div className="flex items-center justify-between gap-3">
         <h2 id={id} className="text-h2">{title}</h2>{badge}
       </div>
       {subtitle && <p className="mt-1 text-text-secondary">{subtitle}</p>}
       <div className="mt-3">{body}</div>
     </section>
   </Card>
   ```
   - pending: `<div aria-hidden="true" className="flex flex-col gap-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>`.
   - error: `<div role="alert" className="flex flex-col items-start gap-2"><p className="text-text-secondary">{t('cardError')}</p><Button variant="outline" onClick={state.retry}><RotateCcwIcon aria-hidden="true" />{t('retry')}</Button></div>` (no `size="sm"`).
   - empty: `<p className="text-text-secondary">{empty}</p>`.
3. **Shared bits in `-cards.tsx`.**
   - `Row`: `<li className="flex items-center justify-between gap-3 py-2"><span className="min-w-0">{left}</span>{right !== undefined && <span className="shrink-0 text-end text-text-secondary tabular-nums">{right}</span>}</li>`; lists `ul className="divide-y divide-border-subtle"`.
   - `Name`: `<span className="block truncate font-medium">`; `RollLine`: `<span className="block text-caption text-text-secondary">{t('roll', { roll: formatNumber(roll, region) })}</span>`.
   - `Stats({ items })`: `<dl className={cn('grid gap-4', items.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>` with `<div><dt className="text-caption text-text-secondary">{label}</dt><dd className={cn('text-h2 tabular-nums', tone)}>{value}</dd></div>`.
   - `SEE_ALL_CLASS` → `'-ms-2 mt-2 inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary no-underline hover:bg-muted md:h-8'` + `<ChevronRightIcon className="size-4" aria-hidden="true" />` after the text.
   - `region = useRegionConfig()` in every card that prints a number.
4. **AbsenteesCard.** `badge`: `notTaken` → `<StatusBadge tone="warning" label={t('notTakenBadge')} />`; `absent.length > 0` → `<StatusBadge tone="danger" label={t('absentCount', { count: absent.length, n: formatNumber(absent.length, region) })} />`; else none. Rows: `left={s.full_name}` in `font-medium`, `right={t('roll', { roll: formatNumber(s.roll_number, region) })}`. Empty lines unchanged.
5. **FlagsCard.** Group title `<h3 className="mt-3 text-label text-text-secondary first:mt-0">` (existing `flagGroups.*`). Row: left = `Name` + `RollLine(i.roll_number)`; right = `<StatusBadge tone={TONE[i.status]} label={t('flagDays', { count: i.length, n: formatNumber(i.length, region) })} />` with `TONE = { ABSENT: 'danger', LATE: 'warning', PRESENT: 'success' } as const`.
6. **DuesCard.** Replace the `duesSummary` paragraph with `Stats` of `[{ label: t('duesTotal'), value: formatServerAmount(total, region) }, { label: t('duesStudents'), value: t('studentCount', { count: n, n: formatNumber(n, region) }) }]` where `n = query.data?.total ?? rows.length`. Then the rows list with `mt-3 border-t border-border-subtle`; right = `formatServerAmount(r.total_due, region)` (now `text-text-primary`: pass a `rightClassName` or render a plain span). Keep the ponytail comment and the `canOpenDues` gate.
7. **HomeworkCard.** `Stats` of total / completed / defaulters through `formatNumber`; defaulters gets `tone="text-status-overdue-fg"` when `> 0`.
8. **ResultsCard.** `subtitle={exam?.name}` (drop the `<p>`); `Stats`: average `outcome?.averageMarks != null ? formatNumber(outcome.averageMarks, region, { decimals: 1 }) : '—'`, pass rate `outcome?.passRate != null ? `${formatNumber(Math.round(outcome.passRate), region)}%` : '—'`. Failed list: `<h3 className="mt-4 text-label text-text-secondary">` + rows (name, roll formatted).
9. **RosterCard.** Row `py-1`; left = `Name` + `RollLine` (was "রোল ৫ · name" in one string). Right with phone: `<a href={`tel:${guardian.phone}`} aria-label={t('callGuardian', { name })} className="-me-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-primary no-underline hover:bg-muted md:h-8"><PhoneIcon className="size-4" aria-hidden="true" />{formatPhone(guardian.phone, region)}</a>` (the `href` keeps the raw number). Without phone: `<span className="flex h-11 items-center text-text-secondary md:h-8">{t('noPhone')}</span>`.
10. **i18n (`myClass.json`, bn + en).**

    | Key | bn | en |
    |---|---|---|
    | `subtitle` (**New**) | {{role}} · আজ {{date}} | {{role}} · Today, {{date}} |
    | `sectionLoadError` (**New**) | এই শাখার তথ্য আনা যায়নি। | Could not load this section. |
    | `notTakenBadge` (**New**) | নেওয়া হয়নি | Not taken |
    | `absentCount` (**New**, en `_one`/`_other`) | {{n}} জন | {{n}} absent |
    | `flagDays` (changed: `{{n}}`, en `_one`/`_other`) | {{n}} দিন | {{n}} day / {{n}} days |
    | `duesTotal` (**New**) | মোট বকেয়া | Total due |
    | `duesStudents` (**New**) | শিক্ষার্থী | Students |
    | `studentCount` (**New**, en `_one`/`_other`) | {{n}} জন | {{n}} |
    | `homeworkCounts.total` (changed) | মোট | Total |

    Remove keys no longer read: `pageTitle`, `duesSummary`.

## Tests
- `$sectionId.test.tsx`:
  - h1 is "Class 7-A" (was "My class · Class 7-A"); the subtitle contains "Class teacher · Today,".
  - the attendance link still has `href` containing `/attendance/section-1` and receives focus.
  - six `h2` card titles unchanged.
  - Absent today shows a badge "1 absent" for one ABSENT row; the not-taken case shows "Not taken" and "Attendance not taken yet.".
  - Flags: the LATE row shows "Late 3 or more days in a row" and a badge "3 days".
  - Results: pass rate renders through `formatNumber` (en: "87%").
  - Roster: the tel link `href` is still `tel:01700000000`, its text is `formatPhone` output ("01700-000000").
  - card retry, empty results, Dues "See all" hidden, not-found — unchanged.
- `e2e/journeys/my-class.spec.ts`: the h1 assertion becomes `getByRole('heading', { level: 1, name: \`${section.class_name}-${section.section_name}\` })`. The `region` lookup by card name and the `link` "take attendance" stay valid.
- `e2e/keyboard/my-class.spec.ts` — run unchanged (link role, focus on load kept).

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view ("আজকের উপস্থিতি নিন").
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] h1 text equals the last crumb.
- [ ] On phone the primary is full width and visible without scrolling; focus lands on it on load.
- [ ] Cards sit in 3 columns at 1440 px, 1 column on phone, in today's order.
- [ ] Roll numbers, day counts, percentages, averages and counts use the tenant's numerals.
- [ ] Phone numbers read "01711-000004" and are 44 px tap targets on phone.
- [ ] Streaks and today's absence show StatusBadges with icons.

## Out of scope
- `flagGroups.*` sentences embed the thresholds as text ("৩", "১৫") rather than formatted numbers — fine while the thresholds are fixed in the server.
- Dues total is summed client-side from one page of 100 (existing ponytail comment) — unchanged.
- `todayIso()` is duplicated in `index.tsx` and `-cards.tsx` — left as is (both local-time correct).
- Sidebar icon duplicate (`user-check`) and the crumb's hyphen vs en dash — shared requests filed (`_staff.tsx`, `use-breadcrumbs.ts`).
- A TEACHER bottom-bar cell for "আমার শ্রেণি" — not requested (see my-class-1).

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| sidebar icon for My class: `book-user` instead of `user-check` (already used by staff attendance) | Accepted | 31.3.1 | nothing to do in this ticket — the layout ticket sets the icon |
| section crumb as `Class – Section` (spaced en dash) | Accepted | 31.3.5 | write the page title in the same form so h1 = last crumb |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: my-class   Decisions: D5, D6, D8, D9, D15, D16, D17, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.my-class-1
