# [31.4.staff-2a] Staff detail — kit header, Profile cards, translated permissions

## Goal
Too big for one ticket, so it is split: **a** (this one) = header, tab row, Profile, Permissions, Memberships (removed) and Login history; **b** (`ticket-b.md`, runs after a) = the other tabs. Done = `/staff/$userId` matches the "after" screenshots for the header and the Profile tab, and the Permissions / Login history tabs show no English enum text or raw browser strings.

## What and why
The page is one staff member's record: who they are, what they can do here, and the admin actions on their account. Today the crumb ends in a UUID, a "back to list" link repeats the crumb, three action buttons sit in a row with a red tinted "remove", tabs are a wrapping pill strip, the Profile tab is one loose grid where the invitation card floats, the Memberships tab repeats the role and join date, and the Permissions tab lists English enum text ("Fee structure read") under lowercase English group names. The redesign uses the kit DetailHeader with facts, puts each control next to what it changes (invitation actions in the invitation callout, "edit teacher profile" on the teacher card), drops the Memberships tab, and translates every permission.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/before-mobile.webp?raw=true" width="260"> |
| After (Profile tab) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/mobile.webp?raw=true" width="260"> |
| After (HR record tab, ticket b) | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/staff/staff_userId/hr-record/mobile.webp?raw=true" width="260"> |

The shots show a teacher whose invitation is still open, so every Profile element is visible.

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | Crumb / back link | "কর্মী তালিকায় ফিরে যান" link removed. The crumb's last item shows the name (B16 — foundation 31.3.5). | D16 |
| 2 | Header | `DetailShell` with `name`, `statusBadge` = user-status badge + invitation badge when not activated, **New** `facts`: ভূমিকা · কর্মচারী আইডি (teachers only) · এই স্কুলে যোগদান (`member_since`) · সর্বশেষ সাইন ইন (`formatDateTime`, or "এখনও করেননি"). | D16, D20; replaces the free-text `identifiers` |
| 3 | Header actions | outline "পাসওয়ার্ড রিসেট করুন" (not on yourself), filled "সম্পাদনা করুন" (edit user), More: "স্কুল থেকে সরান" (tertiary, last). "শিক্ষক প্রোফাইল সম্পাদনা" leaves the header (now on the teacher card, #6). | D16, D29: no red button outside a confirm dialog |
| 4 | Tabs | line tabs, one row, scrolls on phone: প্রোফাইল · অনুমতি · শিক্ষকের দায়িত্ব · এইচআর রেকর্ড · এসিআর · ঘটনা · পারফরম্যান্স · ডকুমেন্ট · উপস্থিতি ও ছুটি · লগইন ইতিহাস. **Memberships tab removed** (its two values are header facts; its note was about other schools, which this page never shows). | D20, D32 ("শিক্ষকতার নিয়োগ" → "শিক্ষকের দায়িত্ব") |
| 5 | Profile — invitation | When `invitation_status !== 'ACTIVATED'`: a callout `rounded-lg border border-border-subtle bg-status-due-bg p-4 md:p-5` (danger tone `bg-status-overdue-bg` for EXPIRED / REVOKED) with a `mail-warning` icon, an `h2` naming the state, one sentence per state (**New**), and the existing outline "আমন্ত্রণ আবার পাঠান" + ghost "আমন্ত্রণ প্রত্যাহার". | Control next to what it changes; D27 |
| 6 | Profile — cards | Card "যোগাযোগ": ইমেইল + badge (যাচাইকৃত success / যাচাই হয়নি neutral), ফোন + same badge, অ্যাকাউন্ট তৈরি. Card "শিক্ষক প্রোফাইল" (teachers only): পদবি, বিষয়ের বিশেষত্ব, যোগদানের তারিখ, and an outline "সম্পাদনা" in the card header that opens `EditTeacherDialog`. FieldGrid `grid gap-4 md:grid-cols-3`. | D27 (verification was grey caption text), kit Card |
| 7 | Permissions | Card with the explainer, then one block per **New** permission group (15 groups, translated title + count) listing translated permission names; `md:grid-cols-3`. `PermissionGroupList` keeps its props; the `/roles` page (which imports it) gets the translations for free. | D9 |
| 8 | Login history | `DataTable` `paginated={false}` (shows "মোট n টি"): কখন (`formatDateTime`), ডিভাইস (**New** readable "Chrome · Windows" from the user agent), আইপি ঠিকানা. Empty → `EmptyState`. | D9 (raw `Mozilla/5.0 …` strings), D19 |

## Mobile behaviour
- Header: crumb, name + badges (wrap), facts in a 2-column grid, then one row: "সম্পাদনা করুন" (`flex-1`) + More (reset password moves into More, remove stays last).
- Tab row scrolls sideways with the fade on the end edge; it never wraps.
- Invitation callout stacks: text, then the two buttons (each 44 px).
- Cards are one column; the teacher card's "সম্পাদনা" stays in the card header.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Memberships tab | Keep · fold into header | Fold into header facts, delete the tab | It held role + member-since only; both are facts now. A tab that repeats the header is noise. |
| Edit teacher profile | Header outline · teacher card | Teacher card header | The button sits next to the fields it changes; header keeps 1 primary + 1 outline. |
| Remove from school | Inline red button · More item | More (last item) | D29: red filled only inside the confirm dialog, which `RemoveMemberDialog` already is. |
| Permission labels | Prettified enum · translated keys | 94 translated keys (every value of the `Permission` enum on main, incl. `MY_CLASS_VIEW` from #1407) + 15 groups in `staff.json` | D9; `staff.json` is already the namespace the `/roles` page reads (`rolesAccess`). |
| User agent | Raw · parsed on server · parsed on client | Small client helper | No API change (D1); the raw string stays in the `title` attribute for support staff. |
| Invitation expiry date | Show · omit | Omit | `UserResponseDto` has no expiry field. |

## Files
- `client-admin/src/routes/_staff/staff/$userId.tsx` — DetailShell facts, badges, actions, tabs list, no back link, no memberships tab
- `client-admin/src/routes/_staff/staff/$userId.test.tsx` — update assertions
- `client-admin/src/routes/_staff/staff/-detail/profile-tab.tsx` — two cards, verification badges, teacher-card edit button
- `client-admin/src/routes/_staff/staff/-detail/profile-tab.test.tsx` — update
- `client-admin/src/routes/_staff/staff/-detail/invitation-card.tsx` — callout look, per-state sentence
- `client-admin/src/routes/_staff/staff/-detail/invitation-card.test.tsx` — update
- `client-admin/src/routes/_staff/staff/-detail/permissions-tab.tsx` — groups + translated labels
- `client-admin/src/routes/_staff/staff/-detail/permission-groups.ts` — **New**, `PERMISSION_GROUPS`
- `client-admin/src/routes/_staff/staff/-detail/permission-groups.test.ts` — **New**
- `client-admin/src/routes/_staff/staff/-detail/memberships-tab.tsx` — deleted
- `client-admin/src/routes/_staff/staff/-detail/login-history-tab.tsx` — DataTable, device label
- `client-admin/src/routes/_staff/staff/-detail/describe-user-agent.ts` (+ `.test.ts`) — **New**
- `ui/src/i18n/locales/bn/staff.json`, `ui/src/i18n/locales/en/staff.json` — keys below (also changed by staff-1, runs earlier)

## Steps
1. **Route (`$userId.tsx`).**
   - Delete the `<Link to="/staff">…detail.back…</Link>` and the wrapping `div`; render the pending / error / `DetailShell` branches directly (the shell gives the page container).
   - `statusBadge={<><StatusBadge domain="user" status={user.status} />{user.invitation_status !== 'ACTIVATED' && <StatusBadge domain="invitation" status={user.invitation_status} />}</>}`.
   - Replace `identifiers` with `facts={[ { label: t('detail.facts.role'), value: user.role !== null ? t(`roles.${user.role}`) : '—' }, ...(teacher ? [{ label: t('detail.profile.employeeId'), value: teacher.employee_id }] : []), { label: t('detail.facts.memberSince'), value: formatDate(user.member_since ?? user.created_at, regionConfig) }, { label: t('detail.facts.lastSignIn'), value: user.last_login_at ? formatDateTime(user.last_login_at, regionConfig) : t('detail.facts.neverSignedIn') } ]}`.
   - `actions`: `{ id:'resetPassword', priority:'secondary', icon:<KeyRoundIcon/>, allowed: canUpdate && user.id !== currentUserId, … }`, `{ id:'editUser', priority:'primary', label: t('detail.actions.editUser'), icon:<PencilIcon/>, … }`, `{ id:'remove', priority:'tertiary', label: t('detail.actions.remove'), icon:<CircleMinusIcon/>, allowed: canRemove, … }`. Delete the `editTeacher` action (moves to `ProfileTab`, step 2). `EditTeacherDialog` stays mounted here; pass `onEditTeacher={() => setEditTeacherOpen(true)}` to `ProfileTab`.
   - Remove `'memberships'` from `tabIds` and its tab object, and the `MembershipsTab` import; delete `-detail/memberships-tab.tsx`. An old `?tab=memberships` URL falls back to the first tab (existing `useDetailShellTab` behaviour).
   - Tab label `attendanceLeave` keeps `t('detailTab.label', { ns: 'staffAttendance' })` (31.3.4b already renames it to "উপস্থিতি ও ছুটি").
2. **Profile tab.**
   - Props: `{ userId: string; onEditTeacher?: () => void }`.
   - Root `div className="space-y-6"`: `<InvitationCard user={user} />`, then Card `<section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">` with `<h2 className="text-h2">{t('detail.profile.contactHeading')}</h2>` and `<dl className="mt-4 grid gap-4 md:grid-cols-3">`: ইমেইল (`break-all`, then `<StatusBadge tone={verified ? 'success' : 'neutral'} label={verified ? t('detail.contact.verifiedBadge') : t('detail.contact.unverified')} />`; when verified the badge has `title={t('detail.contact.verified', { date: formatDate(...) })}`), ফোন (same), অ্যাকাউন্ট তৈরি (`formatDate(user.created_at)`). Remove the role / status / joined / last login items (they are header facts now).
   - Teacher card (only when `teacher`): header row `flex items-start justify-between gap-4` with `h2` `detail.profile.teacherHeading` and, when `canUpdate && onEditTeacher`, an outline Button `<PencilIcon/>{t('detail.profile.editTeacher')}`; `dl` পদবি / বিষয়ের বিশেষত্ব / যোগদানের তারিখ (employee id is a header fact — drop it here).
   - dt `text-caption text-text-secondary`; drop every `text-sm`, `text-xs`, `text-muted-foreground`, `ml-1.5`.
3. **Invitation card.** `section` → `className={cn('flex flex-col gap-3 rounded-lg border border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:p-5', danger ? 'bg-status-overdue-bg' : 'bg-status-due-bg')}` where `danger = status === 'EXPIRED' || status === 'REVOKED'`. Left: `MailWarningIcon` (`mt-0.5 shrink-0`, `text-status-overdue-fg` / `text-status-due-fg`) + `<h2 className="text-h3">{t(`status.invitation.${status}`, { ns: 'common' })}</h2>` + `<p className="text-text-secondary">{t(`detail.invitation.explain.${status}`, { name })}</p>`. Right: resend (outline, `SendIcon`) and revoke (ghost, `XIcon`), drop `size="sm"`. Keep the confirm dialog, the success / error lines and the permission gate unchanged.
4. **Permissions.**
   - New `-detail/permission-groups.ts`: `export const PERMISSION_GROUPS: readonly { id: string; permissions: readonly Permission[] }[]` with exactly the 15 groups of the table below, in that order.
   - `permissions-tab.tsx`: delete `groupPermissions`. `PermissionGroupList` (same props) iterates `PERMISSION_GROUPS`, keeps only permissions present in `permissions`, skips empty groups; title `t(`permissions.groups.${id}`)` + ` (${formatNumber(count, config)})`; items `t(`permissions.items.${permission}`)`. Non-collapsible layout: `div className="grid gap-4 md:grid-cols-3"` of blocks (`h3 className="text-h3"`, `ul className="mt-2 space-y-1 text-text-primary"`, `li` with a `check` icon `size-4 text-status-paid-fg`). Collapsible (`/roles`) keeps `<details>`, summary `text-label font-semibold` — no `capitalize`, no `toLowerCase`.
   - `PermissionsTab`: Card wrapper (Card classes), explainer `text-text-secondary`, then the list in `mt-4`.
5. **Login history.** `DataTable` (`tableId="staff-login-history"`, `caption={t('detail.loginHistory.caption')}`, `paginated={false}`, `emptyState={{ title: t('detail.loginHistory.empty'), explanation: t('detail.loginHistory.emptyExplanation') }}`), columns when (`formatDateTime`), device (`<span title={entry.user_agent ?? ''}>{describeUserAgent(entry.user_agent, t)}</span>`), ip (`entry.ip_address ?? '—'`). `describe-user-agent.ts`: `describeUserAgent(ua: string | null, t): string` → `—` for null; browser = first match of Edge (`Edg/`), Opera (`OPR/`), Chrome, Firefox, Safari (only when no Chrome), else `t('detail.loginHistory.unknownBrowser')`; OS = Windows, Android, iPhone/iPad → iOS, Mac OS X → macOS, Linux, else nothing; returns `"Chrome · Windows"` or `"Chrome"`. `// ponytail: regex sniffing, swap for a UA parser if support needs versions`.
6. **i18n** (`staff.json`, bn / en):
   - add `detail.facts.role` "ভূমিকা" / "Role"; `detail.facts.memberSince` "এই স্কুলে যোগদান" / "Joined this school"; `detail.facts.lastSignIn` "সর্বশেষ সাইন ইন" / "Last sign-in"; `detail.facts.neverSignedIn` "এখনও করেননি" / "Not yet"
   - change `detail.actions.editUser` "সম্পাদনা করুন" / "Edit"
   - change `detail.tabs.teachingAssignments` "শিক্ষকের দায়িত্ব" / "Teacher assignments"
   - add `detail.profile.contactHeading` "যোগাযোগ" / "Contact"; `detail.profile.accountCreated` "অ্যাকাউন্ট তৈরি" / "Account created"; `detail.profile.editTeacher` "সম্পাদনা" / "Edit"
   - add `detail.contact.verifiedBadge` "যাচাইকৃত" / "Verified"; change `detail.contact.unverified` "যাচাই হয়নি" / "Not verified"
   - change `detail.invitation.resend` "আমন্ত্রণ আবার পাঠান" / "Resend invitation"; `detail.invitation.revoke` "আমন্ত্রণ প্রত্যাহার" / "Revoke invitation"
   - add `detail.invitation.explain.NONE` "{{name}}-কে এখনও আমন্ত্রণ পাঠানো হয়নি।" / "{{name}} has not been invited yet."; `.PENDING` "{{name}} এখনও অ্যাকাউন্ট সক্রিয় করেননি। লিংক পাওয়ার পর তিনি নিজের পাসওয়ার্ড ঠিক করে সাইন ইন করতে পারবেন।" / "{{name}} has not activated the account yet. With the link they set a password and sign in."; `.EXPIRED` "আমন্ত্রণ লিংকের মেয়াদ শেষ। নতুন লিংক পাঠান।" / "The invitation link has expired. Send a new one."; `.REVOKED` "আমন্ত্রণ প্রত্যাহার করা হয়েছে। আবার পাঠালে নতুন লিংক যাবে।" / "The invitation was revoked. Resending sends a new link."
   - add `detail.loginHistory.caption` "সাইন ইনের ইতিহাস" / "Sign-in history"; `detail.loginHistory.emptyExplanation` "এই ব্যক্তি সাইন ইন করলে এখানে দেখা যাবে।" / "Sign-ins will show up here."; `detail.loginHistory.unknownBrowser` "অজানা ব্রাউজার" / "Unknown browser"
   - add `permissions.groups.*` and `permissions.items.*` exactly as below. Leave `detail.back` and `detail.memberships.*` for the unused-key report (do not delete).

   | Group id | bn / en | Permissions (item bn / en) |
   |---|---|---|
   | users | কর্মী ও অ্যাকাউন্ট / Staff & accounts | USER_CREATE কর্মী যোগ / Add staff · USER_READ কর্মী দেখা / View staff · USER_UPDATE কর্মীর তথ্য বদলানো / Edit staff · USER_DELETE অ্যাকাউন্ট মোছা / Delete accounts · MEMBER_REMOVE স্কুল থেকে সরানো / Remove from school · STAFF_HR_READ এইচআর রেকর্ড দেখা / View HR records · STAFF_HR_MANAGE এইচআর রেকর্ড বদলানো / Edit HR records |
   | students | শিক্ষার্থী / Students | STUDENT_CREATE শিক্ষার্থী যোগ / Add students · STUDENT_READ শিক্ষার্থী দেখা / View students · STUDENT_UPDATE শিক্ষার্থীর তথ্য বদলানো / Edit students · STUDENT_DELETE শিক্ষার্থী মোছা / Delete students · STUDENT_BULK_UPLOAD একসাথে শিক্ষার্থী আমদানি / Import students · STUDENT_LIFECYCLE_MANAGE ছাড়পত্র ও পুনর্ভর্তি / Leaving & re-admission · STUDENT_NOTES_READ নোট দেখা / View notes · STUDENT_NOTES_WRITE নোট লেখা / Write notes · STUDENT_RECORDS_READ রেকর্ড দেখা / View records · STUDENT_RECORDS_WRITE রেকর্ড লেখা / Write records |
   | guardians | অভিভাবক / Guardians | GUARDIAN_CREATE অভিভাবক যোগ / Add guardians · GUARDIAN_READ অভিভাবক দেখা / View guardians · GUARDIAN_UPDATE অভিভাবকের তথ্য বদলানো / Edit guardians · GUARDIAN_DELETE অভিভাবক মোছা / Delete guardians |
   | admissions | ভর্তি / Admissions | ADMISSION_REVIEW ভর্তির আবেদন যাচাই / Review applications |
   | fees | ফি / Fees | FEE_STRUCTURE_CREATE ফি কাঠামো তৈরি / Create fee structures · FEE_STRUCTURE_READ ফি কাঠামো দেখা / View fee structures · FEE_STRUCTURE_UPDATE ফি কাঠামো বদলানো / Edit fee structures · FEE_STRUCTURE_DELETE ফি কাঠামো মোছা / Delete fee structures · FEE_GENERATE ফি তৈরি / Generate fees · FEE_READ ফি দেখা / View fees · FEE_COLLECT ফি আদায় / Collect fees · FEE_APPROVE ফি-সংক্রান্ত কাজ অনুমোদন / Approve fee actions · DISCOUNT_RULE_MANAGE ছাড়ের নিয়ম / Discount rules · SCHEDULE_MANAGE স্বয়ংক্রিয় বিলের নিয়ম / Automatic billing rules |
   | invoicesPayments | চালান ও পেমেন্ট / Invoices & payments | INVOICE_CREATE চালান তৈরি / Create invoices · INVOICE_READ চালান দেখা / View invoices · INVOICE_PRINT চালান প্রিন্ট / Print invoices · INVOICE_DELETE চালান মোছা / Delete invoices · PAYMENT_RECORD পেমেন্ট রেকর্ড / Record payments · PAYMENT_READ সব পেমেন্ট দেখা / View all payments · PAYMENT_REFUND টাকা ফেরত / Refund payments · PAYMENT_REVERSE পেমেন্ট বাতিল / Reverse payments |
   | communication | যোগাযোগ / Communication | COMMUNICATION_SEND বার্তা পাঠানো / Send messages · COMMUNICATION_BULK_SEND একসাথে অনেককে বার্তা / Send bulk messages · COMMUNICATION_LOG_READ পাঠানো বার্তার তালিকা দেখা / View message log · COMMUNICATION_CREDIT_READ এসএমএস ক্রেডিট দেখা / View SMS credit |
   | reports | প্রতিবেদন ও ড্যাশবোর্ড / Reports & dashboard | REPORTS_VIEW প্রতিবেদন দেখা / View reports · REPORTS_EXPORT প্রতিবেদন এক্সপোর্ট / Export reports · REPORT_COLLECTIONS_READ আদায় প্রতিবেদন দেখা / View collections report · DASHBOARD_VIEW ড্যাশবোর্ড দেখা / View dashboard · DASHBOARD_ADMIN পুরো স্কুলের ড্যাশবোর্ড / School-wide dashboard |
   | academics | একাডেমিক / Academics | ACADEMIC_YEAR_MANAGE শিক্ষাবর্ষ পরিচালনা / Manage academic years · CLASS_MANAGE শ্রেণি ও শাখা পরিচালনা / Manage classes & sections · MY_CLASS_VIEW শ্রেণি শিক্ষকের ‘আমার শ্রেণি’ পাতা দেখা / Open the class teacher's “My class” page · ACADEMIC_STRUCTURE_READ শ্রেণি, শাখা ও বিষয় দেখা / View classes, sections & subjects · CURRICULUM_PRESET_APPLY তৈরি শিক্ষাক্রম চালু করা / Apply a ready-made curriculum · CALENDAR_READ ক্যালেন্ডার দেখা / View calendar · CALENDAR_MANAGE ক্যালেন্ডার পরিচালনা / Manage calendar · ROUTINE_READ রুটিন দেখা / View routines · ROUTINE_MANAGE রুটিন পরিচালনা / Manage routines · SYLLABUS_READ সিলেবাস দেখা / View syllabus · SYLLABUS_MANAGE সিলেবাস পরিচালনা / Manage syllabus · PROGRAM_READ প্রোগ্রাম দেখা / View programs · PROGRAM_MANAGE প্রোগ্রাম পরিচালনা / Manage programs · PROGRAM_RECORD মাইলস্টোন রেকর্ড / Record milestones |
   | homework | বাড়ির কাজ / Homework | HOMEWORK_READ বাড়ির কাজ দেখা / View homework · HOMEWORK_ASSIGN বাড়ির কাজ দেওয়া / Assign homework · HOMEWORK_GRADE বাড়ির কাজ মূল্যায়ন / Grade homework · HOMEWORK_IMPORT বাড়ির কাজ আমদানি / Import homework |
   | attendance | উপস্থিতি ও ছুটি / Attendance & leave | ATTENDANCE_READ উপস্থিতি দেখা / View attendance · ATTENDANCE_MARK উপস্থিতি নেওয়া / Take attendance · ATTENDANCE_CORRECT উপস্থিতি সংশোধন / Correct attendance · ATTENDANCE_DEVICE_MANAGE উপস্থিতির যন্ত্র পরিচালনা / Manage attendance devices · STAFF_ATTENDANCE_READ কর্মীর উপস্থিতি দেখা / View staff attendance · STAFF_ATTENDANCE_MARK কর্মীর উপস্থিতি নেওয়া / Take staff attendance · LEAVE_APPROVE ছুটি অনুমোদন / Approve leave |
   | exams | পরীক্ষা ও ফলাফল / Exams & results | EXAM_MANAGE পরীক্ষা পরিচালনা / Manage exams · GRADING_SCALE_MANAGE গ্রেডিং স্কেল পরিচালনা / Manage grading scales · MARK_ENTER নম্বর দেওয়া / Enter marks · MARK_VIEW নম্বর দেখা / View marks · RESULT_PROCESS ফলাফল তৈরি / Process results · RESULT_PUBLISH ফলাফল প্রকাশ / Publish results · RESULT_READ ফলাফল দেখা / View results · SEAT_PLAN_MANAGE সিট প্ল্যান পরিচালনা / Manage seat plans · PROMOTION_MANAGE প্রমোশন পরিচালনা / Manage promotions · PROMOTION_OVERRIDE প্রমোশনের সিদ্ধান্ত বদলানো / Override promotions |
   | evaluations | মূল্যায়ন / Evaluations | ACR_READ এসিআর দেখা / View ACR · ACR_WRITE এসিআর লেখা ও ঘটনা জানানো / Write ACR & report incidents |
   | printing | প্রিন্ট ও ডকুমেন্ট / Printing & documents | PRINT_TEMPLATE_MANAGE প্রিন্ট টেমপ্লেট পরিচালনা / Manage print templates · DOCUMENT_PRINT ডকুমেন্ট প্রিন্ট / Print documents · PRINT_HISTORY_READ প্রিন্টের ইতিহাস দেখা / View print history · DOCUMENT_REVOKE ডকুমেন্ট বাতিল / Revoke documents |
   | administration | প্রশাসন / Administration | AUDIT_LOG_READ নিরীক্ষা লগ দেখা / View audit log · AUDIT_ENTITY_HISTORY_READ কার্যক্রমের ইতিহাস দেখা / View activity history · SETTINGS_MANAGE সেটিংস পরিচালনা / Manage settings · BACKUP_MANAGE ব্যাকআপ ও পুনরুদ্ধার / Backup & restore |

## Tests
- `permission-groups.test.ts`: every value of `Object.values(Permission)` (94 on main after #1407 — includes `MY_CLASS_VIEW`, TEACHER only) is in exactly one group; group ids are unique; every group id and every permission has a key in both `en/staff.json` and `bn/staff.json` (`permissions.groups.*`, `permissions.items.*`).
- `$userId.test.tsx`: no "কর্মী তালিকায় ফিরে যান" link; no "সদস্যপদ" tab; header shows facts ভূমিকা / এই স্কুলে যোগদান / সর্বশেষ সাইন ইন (and কর্মচারী আইডি for a teacher); exactly one primary button; "স্কুল থেকে সরান" is a menu item inside More; a PENDING user shows the "আমন্ত্রণ মুলতুবি" badge in the header.
- `profile-tab.test.tsx`: verified email shows "যাচাইকৃত", unverified "যাচাই হয়নি"; teacher card's "সম্পাদনা" calls `onEditTeacher`; it is hidden without `USER_UPDATE`.
- `invitation-card.test.tsx`: EXPIRED renders the danger background class and the expired sentence; ACTIVATED renders nothing (existing).
- `describe-user-agent.test.ts`: Chrome on Windows, Safari on iPhone, Firefox on Linux, Edge, null → "—", unknown → "অজানা ব্রাউজার".
- `client-admin/src/routes/_staff/roles/` tests (if they assert lowercase domain text) — update the expected text only; `-role-card.tsx` itself is not edited.
- E2E: `rg -n "detail.back|tabs.memberships|detail.actions" e2e` — `e2e/journeys/password-recovery.spec.ts` uses `staff.detail.actions.resetPassword` (unchanged key, still an outline button on desktop; on phone it is a More item — the spec runs desktop). Fix any spec that clicked the Memberships tab.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot; no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per view.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring.
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] No back link; header shows the facts row; remove is in More.
- [ ] Tab row is one line (scrolls on phone) and has no Memberships tab.
- [ ] Profile shows the invitation callout (when open), the Contact card and the Teacher profile card with its own Edit.
- [ ] Permissions tab shows Bangla group titles and Bangla permission names only; `/roles` shows the same translations.
- [ ] Login history shows "Chrome · Windows"-style devices and a "মোট n টি" footer.

## Out of scope
- Last crumb showing the name instead of the UUID — B16, foundation 31.3.5.
- Tabs Teacher assignments, HR record, ACR, Incidents, Performance, Documents, Attendance & leave — ticket b.
- `RemoveMemberDialog` / `ResetPasswordDialog` / `EditUserDialog` look — they inherit the kit Dialog from the foundation; no change here.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| ownership note: roles -role-card imports PermissionGroupList | Refused | — | nothing to change in shared code; keep PermissionGroupList's props unchanged as the ticket already says |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: staff   Decisions: D5, D9, D16, D19, D20, D27, D28, D29, D32   Depends on: 31.3.8b, 31.4.staff-1
