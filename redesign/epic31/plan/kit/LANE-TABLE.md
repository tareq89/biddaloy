# Lane table (Epic 31.0, wave 4 page tickets)

Run order inside a lane is fixed (each ticket's last line names the one before it). Lanes run in parallel; their `## Files` lists are disjoint (checked by script: 0 shared files across lanes).

`S/` = `client-admin/src/routes/_staff/`, `PL/` = `…/routes/_platform/`, `PO/` = `…/routes/portal/`, `routes/` = `client-admin/src/routes/` (signed-out pages), other paths under `client-admin/src/`. e2e spec files are listed in each ticket and are not repeated here.

| lane | tickets in run order | count | territory |
|---|---|---|---|
| academic-years | academic-years-1 → academic-years-2 | 2 | `S/academic-years/` · ns: academicYears |
| admin | admin-1 → admin-2 → admin-3 → admin-4 | 4 | `S/audit-logs/`; `S/curriculum-preset.tsx`; `pages/curriculum-preset/`; `S/notifications.tsx`; `S/security.tsx` · ns: auditLogs, curriculumPreset |
| admissions | admissions-1 → admissions-2 → admissions-3 → admissions-4 → admissions-5 | 5 | `features/admission/`; `S/admissions/`; `routes/admission/` · ns: admission-staff-applicants, admission-staff-intakes, admission-reports, admission-public |
| attendance | attendance-1 → attendance-2 → attendance-3 | 3 | `S/attendance/` · ns: attendance, staffAttendance, leave |
| calendar | calendar-1a → calendar-1b → calendar-2 | 3 | `S/calendar/`; `components/upcoming-calendar-card`; `components/calendar-feed-card` · ns: calendar, calendarImport |
| classes | classes-1 → classes-2 | 2 | `S/classes/` · ns: classes |
| communications | communications-1 → communications-2a → communications-2b → communications-3 | 4 | `S/communications/` · ns: communications |
| exams | exams-1 → exams-2a → exams-2b → exams-3a → exams-3b → exams-4a → exams-4b | 7 | `S/exams/` · ns: exams, examTemplates, examsTemplateField, seatPlans, seatPlansDetail |
| fees | fees-1 → fees-2 → fees-3a → fees-3b → fees-4a → fees-4b | 6 | `S/fees/ (not fines/)`; `S/fee-structures/` · ns: fees, feeStructures, feeGeneration |
| fines | fines-1a → fines-1b | 2 | `S/fees/fines/` · ns: fines |
| guardians | guardians-1 → guardians-2 | 2 | `S/guardians/` · ns: guardians |
| guest | guest-1 → guest-2 → guest-3 | 3 | `routes/login.tsx`; `routes/select-school.tsx`; `routes/-guest-status.tsx`; `routes/-auth-screen.tsx`; `routes/forgot-password.tsx`; `routes/reset-password.tsx`; `routes/activate.tsx`; `routes/verify-email.tsx`; `routes/i/`; `routes/v/` · ns: auth, verify |
| homework | homework-1 → homework-2 → homework-3 | 3 | `S/academics/` · ns: homework, syllabus |
| marks | marks-1 → marks-2 → marks-3 → marks-4a → marks-4b | 5 | `S/marks/`; `S/results/`; `S/analysis/`; `S/grading-scales/` · ns: grading |
| my-class | my-class-1 → my-class-2 | 2 | `S/my-class/` · ns: myClass |
| payments | payments-1a → payments-1b → payments-2 → payments-3 → payments-4 | 5 | `S/payments/`; `S/invoices/` · ns: payments, approval |
| platform | platform-1 → platform-2 → platform-3 | 3 | `PL/schools/`; `PL/holiday-sets/` · ns: platform |
| portal | portal-1 → portal-2 → portal-3 → portal-4 → portal-5 → portal-6 → portal-7 → portal-8 → portal-9 → portal-10 | 10 | `PO/* (pages; not portal.tsx)` · ns: portal |
| print | print-1 → print-2a → print-2b | 3 | `components/print/library/`; `S/print/`; `S/print-routes.test.tsx`; `components/print/print-id-card-modal`; `components/print/preview/`; `components/print/desktop-only-gate` · ns: printTemplates, printPreview |
| programs | programs-1 → programs-2a → programs-2b | 3 | `S/programs/` · ns: programs |
| promotions | promotions-1 → promotions-2 | 2 | `S/promotions/` · ns: promotions |
| reports | reports-1 → reports-2 | 2 | `ui/src/hooks/reports.ts`; `ui/src/hooks/reports.test.ts`; `S/reports/`; `components/print/history/` · ns: reports, printHistory |
| routines | routines-1a → routines-1b → routines-2 → routines-3a → routines-3b → routines-4a → routines-4b | 7 | `S/routines/` · ns: routines |
| settings | settings-1a → settings-1b → settings-2 → settings-3 → settings-4a → settings-4b | 6 | `S/settings.tsx`; `pages/SchoolSettingsPage`; `pages/settings/` · ns: settings, backup |
| staff | staff-1 → staff-2a → staff-2b → staff-2c → staff-3 → staff-4a → staff-4b → staff-5 | 8 | `S/staff/` · ns: staff, evaluations, teacherAssignments |
| students | students-1 → students-2 → students-3 → students-4 → students-5a → students-5b → students-6a → students-6b → students-7a → students-7b | 10 | `S/students/` · ns: students, studentImport, student-lifecycle, student-notes, student-records |

## Cross-lane edges

None. Every cross-lane link found was checked and is **soft** (works in either order):

| ticket (lane) | touches (lane) | why it is soft |
|---|---|---|
| fees-1, students-5a, students-5b | `/payments/record?student_id=` (payments-1b) | `record.tsx` already accepts `student_id` today (redirects to `/payments?record=1`); payments-1b only changes what the route renders. |
| fees-1, attendance-2 | `SendReminderDialog` (`S/students/-send-reminder-dialog.tsx`, no ticket edits it) | placed with today's props (`open`, `onOpenChange`, `studentIds`, `onSent`). |
| students-5a (`recurring-fees-tab.tsx`) | `GenerateFeesModal` (fees-3b) | fees-3b keeps export name and props. |
| students-5b (`fines-tab.tsx`) | `LogFineModal` (fines-1b) | fines-1b keeps `open` / `onOpenChange`; `fines.logForm.title` key unchanged. |
| guardians-2, students-5b, fees-1 | `RecordPaymentModal` (payments-1b) | payments-1b keeps export name and props; the callers drop their local mount anyway. |
| staff-2b (`attendance-leave-tab.tsx`) | `LeaveRequestDialog` (attendance-3) | attendance-3 keeps props. |
| students-6a (`programs-panel.tsx`) | `EnrolDialog` / `RecordDialog` (programs-2b) | programs-2b keeps names and props. |
| exams-2a (`results-panel.tsx`) | `S/results/-process-dialog.tsx`, `-publish-dialog.tsx`, `-send-result-sms-dialog.tsx` (marks-2) | marks-2 keeps export names and props. |
| staff-3 | `AssignTeacherDialog` (`S/classes/-assign-teacher-dialog.tsx`, no ticket edits it) | placed unchanged. |
| reports-2 | `/print/preview` with `kind`, `subject_type`, `from` (print-2a) | all three search params exist today; print-2a only adds the optional `pick`. |
| portal-1, portal-10, admin-4 | `UpcomingCalendarCard`, `CalendarFeedCard` (calendar-1b) | placed unchanged; calendar-1b keeps props. |
| promotions-2 | `promotions.json` bn wording read by `S/students/-detail/promotion-override-badge.tsx` | en text (asserted by the students test) is unchanged. |
| portal-1, portal-2, portal-6, portal-7, portal-9, marks-2, guest-3, print-2a, print-2b, students-1, students-5b, students-6a, students-6b, staff-2b, platform-2 | e2e specs owned by another lane (`fines.spec.ts`, `result-publish.spec.ts`, `programs.spec.ts`, `survey.spec.ts`, `print-id-cards.spec.ts`, `invoice-sharing.spec.ts`, `curriculum-preset.spec.ts`, …) | run only; every ticket keeps the selectors/keys those specs use. |

Files given to nobody (updated by the wave-4 close ticket 31.5.0): `e2e/keyboard/organisation-structure.spec.ts` (classes-1, settings-1a), `e2e/config.ts` and `e2e/reduced-motion.spec.ts` (guest-1). `unregistered-actions.ts` (calendar-1a, fees-4a): handled by 31.5.1b.

## Totals

- Lanes: 25
- Tickets: 110
- Files across all tickets (en/bn counted separately): 965
- Longest lanes: portal, students (10 tickets each)
- Before screenshots to copy: see `BEFORE-MAP.tsv` (198 rows, none missing).
