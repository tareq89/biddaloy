/**
 * [Epic 44 / #2562] Guide ids that deliberately have no (?) in code: id -> reason.
 * `help-guard.test.ts` fails when one of these is missing from the guide or is used in code (E6),
 * and when a reason does not start with an issue number (`#<n>: …`), or is the E11 public-page
 * reason on an id outside `start.signIn` / `admin.createSchool` (44.3.12). The guard checks the
 * format only, not that the issue is open.
 * The issue that wires an id deletes its line here.
 */
export const PUBLIC = 'E11: public page, no shell';
/** 44.3.x wave 3: the page has no slot for the (?) yet (no element to attach it to). */
const PAGE_FIX = '#3017: page fix pending';
/** The print-templates pages have no slot for these (?) yet. */
const PRINT_FIX = '#3061: page fix pending';
/** The ui/ component has no helpId slot (DataTable row action or expand toggle, FilterBar field). */
const UI_SLOT = '#3078: no helpId slot in ui/';
/** PageHeader puts tertiary/destructive actions in the More menu, which draws no (?). */
const MENU_ITEM = '#3078: header More-menu item has no (?) slot';
/** The element lives in a file outside the wave-3 lane territory. */
const TERRITORY = '#3079: element outside the wave-3 territory';
/** A More-menu action that opens no dialog, so its (?) has nowhere to go (#3078 puts it on the dialog). */
const NO_DIALOG = '#3017: More-menu action opens no dialog, no (?) slot';
/** The section describes the public admission pages, which have no shell and no (?) (E11). */
const PUBLIC_FORM = '#3017: section of a public page, no (?) there (E11)';
/** The guide declares a second id for an element that already carries one. */
const SAME_ELEMENT = '#3017: same element as reports.printables.action.revoke';
/** A per-row control in a list; a (?) on every row is noise (D18), and no dialog opens. */
const ROW_CONTROL = '#3063: per-row control, no dialog to hold the (?)';

/** The guide declares the field and its `help.<key>` text is written; no route puts the (?) there yet. */
const GAP = '#3017: help text written, (?) not wired yet';

export const HELP_UNWIRED: Record<string, string> = {
  'start.signIn': PUBLIC,
  'start.signIn.action.submit': PUBLIC,
  'start.signIn.field.identifier': PUBLIC,
  'admin.createSchool': PUBLIC,
  'admin.createSchool.action.continue': PUBLIC,
  'admin.createSchool.action.verify': PUBLIC,

  // 44.3.01-44.3.06
  'people.teachingAssignments.action.unassign': UI_SLOT,
  'people.evaluations.action.completeAcr': PAGE_FIX,
  'people.evaluations.action.reopenAcr': PAGE_FIX,
  'people.calendar.action.regenerateFeed': PAGE_FIX,
  'people.programs.action.removeMilestone': PAGE_FIX,
  'people.admissionIntakes.section.publicForm': PUBLIC_FORM,
  'people.admissionIntakes.section.status': PUBLIC_FORM,
  'people.admissionReports.field.academicYear': UI_SLOT,
  'people.admissionReports.field.class': UI_SLOT,
  'academics.classes.action.deleteSection': UI_SLOT,
  'academics.routineSetup.action.deleteShift': UI_SLOT,
  'academics.routineBuilder.action.clearCell': PAGE_FIX,
  'academics.routineReview.action.requestChange': PAGE_FIX,
  'academics.routineReview.action.resolveRequest': PAGE_FIX,
  'academics.syllabus.action.deleteTopic': UI_SLOT,
  'attendance.attendanceReports.action.sendReminder': PAGE_FIX,
  'reports.collectionsReport.field.preset': UI_SLOT,
  'reports.collectionsReport.field.collector': UI_SLOT,
  'reports.printables.field.validity': TERRITORY,
  'reports.applications.field.academicYear': UI_SLOT,
  'reports.applications.field.submitted': UI_SLOT,
  'academics.academicYears.action.delete': MENU_ITEM,
  'academics.syllabus.action.deletePlan': MENU_ITEM,
  'people.programs.action.archive': NO_DIALOG,
  'people.programs.action.delete': MENU_ITEM,
  'people.students.action.delete': MENU_ITEM,
  'people.students.action.printIdCard': NO_DIALOG,

  // 44.3.07-44.3.11
  'examsResults.examTemplates.action.delete': '#3046: page fix pending',
  'finance.feeStructures.action.delete': '#3057: page fix pending',
  'finance.recurringSchedules.action.deactivate': '#3058: page fix pending',
  'administration.printTemplates.action.makeDefault': PRINT_FIX,
  'administration.printTemplates.action.print': PRINT_FIX,
  'administration.printTemplates.action.revoke': SAME_ELEMENT,
  'administration.printTemplates.field.kind': PRINT_FIX,
  'administration.auditLogs.field.performedBy': '#3062: page fix pending',
  'portal.notifications.action.close': ROW_CONTROL,
  'portal.notifications.action.snooze': ROW_CONTROL,

  // 44.3.12: declared in the guide after the wave-3 pass ran
  'administration.auditLogs.action.expand': UI_SLOT,
  'administration.printTemplates.action.create': PRINT_FIX,
  'administration.printTemplates.action.archive': PRINT_FIX,

  // Help text written (was HELP_GAPS): indexed now, wireable by the route lanes
  'people.students.field.rollNumber': GAP,
  'people.students.field.bloodGroup': GAP,
  'people.students.field.preferredCommunication': GAP,
  'people.guardians.field.preferredCommunication': GAP,
  'people.calendar.field.countsAsWorkingDay': GAP,
  'people.calendar.field.notify': GAP,
  'people.calendar.field.lateReason': GAP,
  'people.staff.field.employeeId': GAP,
  'people.staffImport.field.sendInvitations': GAP,
  'people.admissionIntakes.field.dates': GAP,
  'people.admissionApplicants.field.guardianChoice': GAP,
  'people.admissionApplicants.field.notes': GAP,
  'people.evaluations.field.minResponses': GAP,
  'people.evaluations.field.targets': GAP,
  'academics.academicYears.field.isCurrent': GAP,
  'academics.academicYears.field.dates': GAP,
  'academics.routineSetup.field.changeover': GAP,
  'academics.routineSetup.field.maxPeriodsPerDay': GAP,
  'academics.routineSetup.field.maxConsecutive': GAP,
  'academics.routineBuilder.field.teachers': GAP,
  'academics.routineBuilder.field.recurrence': GAP,
  'academics.routineSubstitutions.field.cancelled': GAP,
  'academics.routineSubstitutions.field.substituteTeacher': GAP,
  'academics.myRoutine.field.lessonStatus': GAP,
  'academics.myRoutine.field.notTaughtReason': GAP,
  'academics.homework.field.target': GAP,
  'academics.syllabus.field.topicStatus': GAP,
  'academics.syllabus.field.periods': GAP,
  'attendance.attendanceReports.field.threshold': GAP,
  'attendance.attendanceRegister.field.reason': GAP,
  'examsResults.exams.field.name': GAP,
  'examsResults.exams.field.kind': GAP,
  'examsResults.marksEntry.field.exam': GAP,
  'examsResults.marksEntry.field.mark': GAP,
  'examsResults.analysis.field.byPart': GAP,
  'examsResults.promotion.field.targetClass': GAP,
  'examsResults.promotion.field.exams': GAP,
  'examsResults.promotion.field.algorithm': GAP,
  'examsResults.promotion.field.finalOutcome': GAP,
  'examsResults.promotion.field.overrideNote': GAP,
  'finance.dues.field.flagged': GAP,
  'finance.recurringSchedules.field.rule': GAP,
  'finance.recurringSchedules.field.dueDays': GAP,
  'finance.recurringSchedules.field.audience': GAP,
  'finance.payments.field.includeReversed': GAP,
  'communications.sendMessage.field.guardian': GAP,
  'communications.sendMessage.field.medium': GAP,
  'communications.sendMessage.field.message': GAP,
  'communications.feeReminders.field.guardians': GAP,
  'communications.feeReminders.field.message': GAP,
  'communications.feeReminders.field.medium': GAP,
  'communications.reminderHistory.field.status': GAP,
};
