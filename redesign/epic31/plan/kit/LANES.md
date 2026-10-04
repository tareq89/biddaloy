# Lanes, agents, tickets (Epic 31.0 wave 4 — page redesigns)

Route files are under `client-admin/src/routes/`. `S` = `_staff/`, `PO` = `portal/`, `PL` = `_platform/`.
"Before" screenshots: `PLAN/../ux-audit/{desktop,mobile}/<role>__<slug>.png`.
Ticket id = `<lane>-<n>` → title prefix `[31.4.<lane>-<n>]`, folder `PLAN/pages/<lane>/<slug>/`.
A ticket marked (2 mockups) covers two pages: one mockup folder per page.
"FP" = the page becomes a full-page modal (D22/D23): use `starter-fullpage.html`.

## Namespace ownership (locale files `ui/src/i18n/locales/{en,bn}/<ns>.json`)

| Lane | Owns namespaces |
|---|---|
| students | students, student-lifecycle, student-notes, student-records, studentImport |
| guardians | guardians |
| staff | staff, evaluations, teacherAssignments, performance |
| admissions | admission-public, admission-reports, admission-staff-applicants, admission-staff-intakes |
| programs | programs |
| academic-years | academicYears |
| classes | classes |
| calendar | calendar, calendarFeed, calendarImport |
| routines | routines |
| homework | homework, syllabus |
| my-class | myClass |
| attendance | attendance, staffAttendance, leave |
| fines | fines |
| exams | exams, examTemplates, examsTemplateField, seatPlans, seatPlansDetail |
| marks | grading |
| promotions | promotions |
| fees | fees, feeGeneration, feeStructures |
| payments | payments, approval |
| communications | communications |
| reports | reports, printHistory |
| print | printTemplates, printPreview, printEditor |
| settings | settings, backup, presetReset, presetWarning, push |
| admin | auditLogs, curriculumPreset |
| portal | portal |
| platform | platform |
| guest | auth, verify |
| (foundation only) | common, nav, bulkImport |

## Agents

### students-a  (lane students; staff shell; nav item শিক্ষার্থী)
- students-1 — `/students` list — `S/students/index.tsx` — before `admin__students`
- students-2 — Add / edit student, FP — `S/students/new.tsx`, `S/students/$studentId_.edit.tsx`, `S/students/-student-form.tsx` — before `admin__students_new` (mock the "new" form once; edit is the same form)
- students-3 — Import students, FP — `S/students/import.tsx` — before `admin__students_import`

### students-b  (lane students; detail page; tickets run after students-a's)
- students-4 — Student detail: header + tab strip + Overview tab — `S/students/$studentId.tsx` + overview files in `S/students/-detail/` — before `admin__students_studentId`
- students-5 — Student detail money tabs: Fees, Invoices, Payments, Fines, Discounts — files in `S/students/-detail/` — mock the Fees tab
- students-6 — Student detail study tabs: Enrollment, Attendance, Results, Homework, Programs, Subjects, Performance — mock the Enrollment tab
- students-7 — Student detail people & records tabs: Guardians, Communication, Activity, Notes, Records, Documents, plus the leave / re-admit dialogs — mock the Guardians tab
(students-4…7 each list only the `-detail/` files of their own tabs; no file appears in two of them unless unavoidable — then say so.)

### guardians-promotions  (two lanes)
- guardians-1 — `/guardians` list — `S/guardians/index.tsx` — before `admin__guardians`
- guardians-2 — Guardian detail — `S/guardians/$guardianId.tsx` (+ `-detail` files) — before `admin__guardians_guardianId`
- promotions-1 — `/promotions` list + New promotion run FP (2 mockups) — `S/promotions/index.tsx`, `S/promotions/new.tsx` — before `admin__promotions`, `admin__promotions_new`
- promotions-2 — Promotion run — `S/promotions/$runId.tsx` — before: none captured? check `ls`

### staff-a  (lane staff)
- staff-1 — `/staff` list + Add user dialog — `S/staff/index.tsx`, `S/staff/-add-user-dialog.tsx` — before `admin__staff`
- staff-2 — Staff detail (tabs) — `S/staff/$userId.tsx` + `S/staff/-detail/**` — before `admin__staff_userId`
- staff-3 — `/staff/teaching-assignments` — before `admin__staff_teaching-assignments`

### staff-b  (lane staff; after staff-a's)
- staff-4 — `/staff/evaluations` + survey detail (2 mockups); the survey form becomes FP — `S/staff/evaluations.tsx`, `S/staff/evaluations_.surveys.$surveyId.tsx`, `S/staff/-evaluations/**` — before `admin__staff_evaluations`, `admin__staff_evaluations_surveys_surveyId`
- staff-5 — ACR form, FP — `S/staff/$userId_.acr.$assessmentId.tsx`, `S/staff/-acr/**` — before `admin__staff_userId_acr_assessmentId`

### admissions-a  (lane admissions; feature folder `client-admin/src/features/admission/**` belongs to this lane)
- admissions-1 — `/admissions/applicants` list — before `admin__admissions_applicants`
- admissions-2 — Applicant detail — before `admin__admissions_applicants_applicantId`
- admissions-3 — `/admissions/intakes` list + intake detail (2 mockups) — before `admin__admissions_intakes`, `admin__admissions_intakes_intakeId`

### admissions-b  (lane admissions; after admissions-a's)
- admissions-4 — `/admissions/reports` — before `admin__admissions_reports`
- admissions-5 — Public admission form + status page (2 mockups, `starter-guest.html`, wider card allowed for the form) — `admission/$slug/index.tsx`, `admission/$slug/status.tsx`, `features/admission/PublicAdmissionForm*` — before: not captured. User wants easy Bangla for all public admission text.

### structure  (two lanes: programs, academic-years)
- programs-1 — `/programs` list — before `admin__programs`
- programs-2 — Program detail — `S/programs/$programId.tsx` + helpers — before `admin__programs_programId`
- academic-years-1 — `/academic-years` list — before `admin__academic-years`
- academic-years-2 — Academic year detail — before `admin__academic-years_academicYearId`

### classes-calendar  (two lanes: classes, calendar)
- classes-1 — `/classes` list (+ class form dialog) — before `admin__classes`
- classes-2 — Class detail — before `admin__classes_classId`
- calendar-1 — `/calendar` (D26; event form dialog has 9 fields → FP) — `S/calendar/index.tsx` + helpers; also `client-admin/src/components/upcoming-calendar-card.tsx`, `calendar-feed-card.tsx` — before `admin__calendar`
- calendar-2 — Import calendar, FP — `S/calendar/import.tsx` — before `admin__calendar_import`

### routines-a  (lane routines)
- routines-1 — `/routines` + `/routines/$sectionId` (2 mockups) — before `admin__routines`, `admin__routines_sectionId`
- routines-2 — `/routines/my` — before `admin__routines_my`

### routines-b  (lane routines; after routines-a's)
- routines-3 — `/routines/review` + `/routines/substitutions` (2 mockups) — before `admin__routines_review`, `admin__routines_substitutions`
- routines-4 — `/routines/setup` — `S/routines/setup.tsx`, `S/routines/-setup/**` — before `admin__routines_setup`

### homework  (lane homework)
- homework-1 — `/academics/homework` list + homework detail (2 mockups) — before `admin__academics_homework`, `…_homework_homeworkId`
- homework-2 — New homework FP + import homework FP (2 mockups) — `S/academics/homework/new.tsx`, `import.tsx`, `client-admin/src/components/homework/**` — before `admin__academics_homework_new`, `…_import`
- homework-3 — `/academics/syllabus` — before `admin__academics_syllabus`

### my-class  (lane my-class; staff shell, TEACHER only — `MY_CLASS_VIEW`; nav item আমার শ্রেণি; added by PR #1407 after the audit, so there are no "before" shots — capture them as `teacher` first)
- my-class-1 — `/my-class` — `S/my-class/index.tsx` (+ `index.test.tsx`) — section cards with role badge, the empty state, the one-section redirect (keeps `?then=attendance`). The seed teacher has one section, so the page redirects: mock the 2-section list and the empty state. Today the card name reads "{class} {section}" (`index.tsx:105`) while the crumb says "{class}-{section}" — use one form.
- my-class-2 — `/my-class/$sectionId` — `S/my-class/$sectionId.tsx`, `S/my-class/-cards.tsx` (+ `$sectionId.test.tsx`) — attendance button first, then the six cards. D16: the `h1` is `myClass.pageTitle` "আমার শ্রেণি · {{section}}" today but the last crumb is the section alone (31.3.5) — make the `h1` equal the crumb.

### attendance-a  (lane attendance)
- attendance-1 — `/attendance` + mark attendance `/attendance/$sectionId` (2 mockups) — before `admin__attendance`, `admin__attendance_sectionId`
- attendance-2 — `/attendance/register` + `/attendance/reports` (2 mockups) — before `admin__attendance_register`, `admin__attendance_reports`

### attendance-b-fines  (lanes attendance [after attendance-a's] and fines)
- attendance-3 — `/attendance/staff` + `/attendance/staff/leave` (2 mockups) — before `admin__attendance_staff`, `admin__attendance_staff_leave`
- fines-1 — `/fees/fines` + `/fees/fines/rules` (2 mockups; generate-fines and log-fine modals → FP per D21) — `S/fees/fines/**` — before `accountant__fees_fines`, `accountant__fees_fines_rules`

### exams-a  (lane exams)
- exams-1 — `/exams` list — `S/exams/index.tsx` — before `admin__exams`
- exams-2 — Exam detail — `S/exams/$examId.tsx`, `S/exams/-detail/**` — before `admin__exams_examId`

### exams-b  (lane exams; after exams-a's)
- exams-3 — Exam templates list + detail (2 mockups) — `S/exams/templates/**` — before `admin__exams_templates`, `…_templates_templateId`
- exams-4 — Seat plans list + detail (2 mockups; generate modal → FP) — `S/exams/seat-plans/**` — before `admin__exams_seat-plans`, `…_seat-plans_planId`

### marks-a  (lane marks)
- marks-1 — `/marks` + marks grid (2 mockups) — `S/marks/**` — before `admin__marks`, `admin__marks_examId_sectionId_subjectId` (the grid shot shows an error card — audit artefact; design from the code)
- marks-2 — `/results` + result detail (2 mockups) — `S/results/**` — before `admin__results`, `admin__results_examId_studentId` (same artefact)

### marks-b  (lane marks; after marks-a's)
- marks-3 — `/analysis` — `S/analysis/**` — before `admin__analysis`
- marks-4 — Grading scales list + detail (2 mockups) — `S/grading-scales/**` — before `admin__grading-scales`, `…_scaleId`

### fees-a  (lane fees)
- fees-1 — `/fees/dues` (and `/fees` index redirects here, D40) — `S/fees/dues.tsx`, `S/fees/index.tsx` — before `accountant__fees_dues`, `accountant__fees`
- fees-2 — `/fee-structures` — `S/fee-structures/**` — before `accountant__fee-structures`

### fees-b  (lane fees; after fees-a's)
- fees-3 — `/fees/generate` list + Generate fees FP (2 mockups) — `S/fees/generate.tsx`, `S/fees/-generate/**`, `S/fees/-generations/**` — before `accountant__fees_generate`
- fees-4 — `/fees/schedules` + schedule detail (2 mockups; schedule form → FP) — `S/fees/schedules/**` — before `accountant__fees_schedules`, `…_schedules_id`

### payments  (lane payments)
- payments-1 — `/payments` list + Record payment FP (2 mockups) — `S/payments/index.tsx`, `S/payments/record.tsx`, `S/payments/-record/**` — before `accountant__payments`, `accountant__payments_record`
- payments-2 — Payment detail — `S/payments/$id.tsx` — before `accountant__payments_id`
- payments-3 — `/invoices` list — `S/invoices/index.tsx` — before `accountant__invoices`
- payments-4 — Invoice detail — `S/invoices/$invoiceId.tsx` — before `accountant__invoices_invoiceId`

### communications  (lane communications)
- communications-1 — `/communications/send` — before `admin__communications_send`
- communications-2 — `/communications/reminders` (wizard) — `S/communications/reminders.tsx`, `S/communications/-bulk/**` — before `accountant__communications_reminders`
- communications-3 — `/communications/batches` + batch detail (2 mockups) — before `accountant__communications_batches`, `…_batches_batchId`

### reports-print  (two lanes: reports, print)
- reports-1 — `/reports/collections` (fix B6; granted `ui/src/hooks/reports.ts` + its test) — before `accountant__reports_collections` (crash screen)
- reports-2 — `/reports/printables` — `S/reports/printables.tsx`, `client-admin/src/components/print/history/**` — before `admin__reports_printables`
- print-1 — `/print-templates` library — `S/print-templates/index.tsx`, `client-admin/src/components/print/library/**` — before `admin__print-templates`
- print-2 — Print preview + ID-card picker as one FP (D23; user asked for this by name; add a visible Close) — `S/print/preview.tsx`, `client-admin/src/components/print/preview/**`, `print-id-card-modal.tsx` — before `admin__print_preview`

### settings-a  (lane settings; files `S/settings.tsx`, `client-admin/src/pages/SchoolSettingsPage.tsx`, `client-admin/src/pages/settings/**`)
- settings-1 — Settings frame: 7 categories (D30) + School category (profile, shift/version/group, regional with "Advanced", calendar) — before `admin__settings`
- settings-2 — Academics + Finance categories (attendance policy, evaluations, ACR criteria, curriculum-preset link; fees)

### settings-b  (lane settings; after settings-a's)
- settings-3 — Communication category (SMS, SMS credit, WhatsApp, Messenger, Email)
- settings-4 — Printing, Sign-in & security, Backup categories (printers + printer form dialog, sign-in options, backup & restore)

### admin  (lane admin)
- admin-1 — `/audit-logs` — before `admin__audit-logs`
- admin-2 — `/curriculum-preset` — `S/curriculum-preset.tsx`, `client-admin/src/pages/curriculum-preset/**` — before `admin__curriculum-preset`
- admin-3 — `/notifications` (infinite scroll over the persisted client store, D4) — `S/notifications.tsx` — before `admin__notifications`
- admin-4 — `/security` — `S/security.tsx` — before `admin__security`

### portal-a  (lane portal; `starter-portal.html`; before shots are `parent__portal…`)
- portal-1 — `/portal` overview — `PO/index.tsx`
- portal-2 — `/portal/fees` — `PO/fees.tsx`
- portal-3 — `/portal/attendance` — `PO/attendance.tsx`
- portal-4 — `/portal/calendar` — `PO/calendar.tsx`

### portal-b  (lane portal; after portal-a's)
- portal-5 — `/portal/exam-schedule` + `/portal/routine` (2 mockups)
- portal-6 — `/portal/results`
- portal-7 — `/portal/programs`

### portal-c  (lane portal; after portal-b's)
- portal-8 — `/portal/syllabus`
- portal-9 — `/portal/surveys`
- portal-10 — `/portal/account`

### platform  (lane platform; `starter-platform.html`; before shots `super_admin__…`)
- platform-1 — `/schools` list + New school FP (2 mockups) — `PL/schools/index.tsx`, `PL/schools/new.tsx` + helpers
- platform-2 — School detail — `PL/schools/$schoolId.tsx`, `PL/schools/-detail/**`
- platform-3 — Holiday sets list + detail (2 mockups) — `PL/holiday-sets/**`

### guest  (lane guest; `starter-guest.html`; before shots `guest__…`)
- guest-1 — Login + choose school (2 mockups) — `login.tsx`, `select-school.tsx`, shared `-auth-screen.tsx` if present
- guest-2 — Forgot password, reset password, activate account, verify email (mock forgot + reset form; the other two follow the same layout — say so) — `forgot-password.tsx`, `reset-password.tsx`, `activate.tsx`, `verify-email.tsx`
- guest-3 — Public receipt `/i/$token` + verification `/v/$token` (2 mockups) — `i/$token.tsx`, `v/$token.tsx`
