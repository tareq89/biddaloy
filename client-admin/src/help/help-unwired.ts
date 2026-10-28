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
/**
 * The guide declared the id after its wave-3 ticket ran; #3143 wires all 11. The 7 `applications.*`
 * ids also need the Epic 52 e2e locators fixed (D14); the 4 curriculum-preset and setup-order ids
 * only need the wiring.
 */
const LATE = '#3143: declared after the wave-3 pass';
/** The guide id is outside the helpId grammar (no .action./.field./.section.); see the grammar test. */
export const OFF_GRAMMAR = '#3148: settings id outside the helpId grammar';

/** In HELP_GAPS: the guide declares the field but no `help.<key>` text exists, so it is not indexed. */
const GAP = '#3017: guide gap, field help not written yet';

export const HELP_UNWIRED: Record<string, string> = {
  'start.signIn': PUBLIC,
  'start.signIn.action.submit': PUBLIC,
  'start.signIn.field.identifier': PUBLIC,
  'admin.createSchool': PUBLIC,
  'admin.createSchool.action.continue': PUBLIC,
  'admin.createSchool.action.verify': PUBLIC,

  // 44.3.01-44.3.06
  'people.staffImport.action.confirm': TERRITORY,
  'people.staffImport.field.role': TERRITORY,
  'people.teachingAssignments.action.unassign': UI_SLOT,
  'people.teachingAssignments.field.assignmentType': TERRITORY,
  'people.evaluations.action.completeAcr': PAGE_FIX,
  'people.evaluations.action.reopenAcr': PAGE_FIX,
  'people.calendar.action.regenerateFeed': PAGE_FIX,
  'people.programs.action.removeMilestone': PAGE_FIX,
  'people.admissionIntakes.action.add': TERRITORY,
  'people.admissionIntakes.field.classSection': TERRITORY,
  'people.admissionIntakes.field.seatCount': TERRITORY,
  'people.admissionIntakes.field.requiredDocuments': TERRITORY,
  'people.admissionIntakes.section.publicForm': TERRITORY,
  'people.admissionIntakes.section.status': TERRITORY,
  'people.admissionApplicants.action.shortlist': UI_SLOT,
  'people.admissionApplicants.action.admit': UI_SLOT,
  'people.admissionApplicants.action.reject': UI_SLOT,
  'people.admissionApplicants.action.deleteDocuments': UI_SLOT,
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
  'reports.printables.action.reprint': TERRITORY,
  'reports.printables.action.revoke': TERRITORY,
  'reports.printables.action.printAdmitCards': TERRITORY,
  'reports.printables.action.printIdCards': TERRITORY,
  'reports.printables.action.exportRegister': TERRITORY,
  'reports.printables.field.revokeReason': TERRITORY,
  'reports.printables.field.validity': TERRITORY,
  'reports.applications.field.academicYear': UI_SLOT,
  'reports.applications.field.submitted': UI_SLOT,
  'academics.academicYears.action.delete': MENU_ITEM,
  'academics.routineReview.action.copyYear': MENU_ITEM,
  'academics.syllabus.action.copyToSection': MENU_ITEM,
  'academics.syllabus.action.deletePlan': MENU_ITEM,
  'people.programs.action.archive': MENU_ITEM,
  'people.programs.action.delete': MENU_ITEM,
  'people.staff.action.remove': MENU_ITEM,
  'people.students.action.delete': MENU_ITEM,
  'people.students.action.printIdCard': MENU_ITEM,
  'people.students.action.sendReminder': MENU_ITEM,

  // 44.3.07-44.3.11
  'examsResults.exams.action.edit': MENU_ITEM,
  'examsResults.examTemplates.action.delete': '#3046: page fix pending',
  'finance.feeStructures.action.delete': '#3057: page fix pending',
  'finance.recurringSchedules.action.deactivate': '#3058: page fix pending',
  'administration.printTemplates.action.confirmRound': PRINT_FIX,
  'administration.printTemplates.action.makeDefault': PRINT_FIX,
  'administration.printTemplates.action.print': PRINT_FIX,
  'administration.printTemplates.action.publish': PRINT_FIX,
  'administration.printTemplates.action.revoke': PRINT_FIX,
  'administration.printTemplates.field.batchSize': PRINT_FIX,
  'administration.printTemplates.field.design': PRINT_FIX,
  'administration.printTemplates.field.kind': PRINT_FIX,
  'administration.printTemplates.field.printer': PRINT_FIX,
  'administration.auditLogs.field.performedBy': '#3062: page fix pending',
  'portal.notifications.action.close': '#3063: page fix pending',
  'portal.notifications.action.snooze': '#3063: page fix pending',
  'start.language.action.switch': '#3064: page fix pending',
  'start.phone.action.install': '#3065: page fix pending',

  // 44.3.12: declared in the guide after the wave-3 pass ran
  'applications.action.cancelLeave': MENU_ITEM,
  'applications.action.approve': LATE,
  'applications.action.reject': LATE,
  'applications.action.withdraw': LATE,
  'applications.action.bulkApprove': LATE,
  'applications.field.addressee': LATE,
  'applications.field.applicant': LATE,
  'applications.field.attachments': LATE,
  'administration.curriculumPreset.action.apply': LATE,
  'administration.curriculumPreset.field.stages': LATE,
  'administration.curriculumPreset.field.confirmName': LATE,
  'admin.setupOrder.action.continueSetup': LATE,
  'administration.auditLogs.action.expand': UI_SLOT,
  'administration.printTemplates.action.create': PRINT_FIX,
  'administration.printTemplates.action.archive': PRINT_FIX,

  // 44.3.12 review: declared by the settings page outside the grammar, so the guard missed them
  'administration.settings.logo': OFF_GRAMMAR,
  'administration.settings.organisation': OFF_GRAMMAR,
  'administration.settings.attendance': OFF_GRAMMAR,
  'administration.settings.autoAbsent': OFF_GRAMMAR,
  'administration.settings.approvalMode': OFF_GRAMMAR,
  'administration.settings.secondApprover': OFF_GRAMMAR,
  'administration.settings.lateFees': OFF_GRAMMAR,
  'administration.settings.buySeats': OFF_GRAMMAR,
  'administration.settings.smsProvider': OFF_GRAMMAR,
  'administration.settings.smsCredit': OFF_GRAMMAR,
  'administration.settings.guardianSmsFallback': OFF_GRAMMAR,
  'administration.settings.printers': OFF_GRAMMAR,
  'administration.settings.otpLogin': OFF_GRAMMAR,
  'administration.settings.backup': OFF_GRAMMAR,
  'administration.settings.backupSchedule': OFF_GRAMMAR,
  'administration.settings.restore': OFF_GRAMMAR,

  // Guide gaps (HELP_GAPS): declared, not indexable, so not wireable yet
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
