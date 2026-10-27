/**
 * [Epic 44 / #2562] Guide ids that deliberately have no (?) in code: id -> reason.
 * `help-guard.test.ts` fails when one of these is missing from the guide or is used in code (E6).
 */
const PUBLIC = 'E11: public page, no shell';
/** 44.3.x wave 3: the page has no slot for the (?) yet (no element to attach it to). */
const PAGE_FIX = '#3017: page fix pending';
/** The ui/ component has no helpId slot (DataTable row action, FilterBar field). */
const UI_SLOT = '#3078: no helpId slot in ui/';
/** PageHeader puts tertiary/destructive actions in the More menu, which draws no (?). */
const MENU_ITEM = '#3078: header More-menu item has no (?) slot';
/** The element lives in a file outside the wave-3 lane territory. */
const TERRITORY = '#3079: element outside the wave-3 territory';

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
  'examsResults.examTemplates.action.delete': '#3046: page fix pending',
  'finance.feeStructures.action.delete': '#3057: page fix pending',
  'finance.recurringSchedules.action.deactivate': '#3058: page fix pending',
  'administration.printTemplates.action.confirmRound': '#3061: page fix pending',
  'administration.printTemplates.action.makeDefault': '#3061: page fix pending',
  'administration.printTemplates.action.print': '#3061: page fix pending',
  'administration.printTemplates.action.publish': '#3061: page fix pending',
  'administration.printTemplates.action.revoke': '#3061: page fix pending',
  'administration.printTemplates.field.batchSize': '#3061: page fix pending',
  'administration.printTemplates.field.design': '#3061: page fix pending',
  'administration.printTemplates.field.kind': '#3061: page fix pending',
  'administration.printTemplates.field.printer': '#3061: page fix pending',
  'administration.auditLogs.field.performedBy': '#3062: page fix pending',
  'portal.notifications.action.close': '#3063: page fix pending',
  'portal.notifications.action.snooze': '#3063: page fix pending',
  'start.language.action.switch': '#3064: page fix pending',
  'start.phone.action.install': '#3065: page fix pending',
};
