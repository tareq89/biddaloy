/**
 * [Epic 44 / #2562] Guide ids that deliberately have no (?) in code: id -> reason.
 * `help-guard.test.ts` fails when one of these is missing from the guide or is used in code (E6).
 */
const PUBLIC = 'E11: public page, no shell';
/** 44.3.x wave 3: the page has no slot for the (?) yet (outside the lane, no helpId in ui/, no element). */
const PAGE_FIX = '#3017: page fix pending';

export const HELP_UNWIRED: Record<string, string> = {
  'start.signIn': PUBLIC,
  'start.signIn.action.submit': PUBLIC,
  'start.signIn.field.identifier': PUBLIC,
  'admin.createSchool': PUBLIC,
  'admin.createSchool.action.continue': PUBLIC,
  'admin.createSchool.action.verify': PUBLIC,

  // 44.3.01-44.3.06
  'people.staffImport.action.confirm': PAGE_FIX,
  'people.staffImport.field.role': PAGE_FIX,
  'people.teachingAssignments.action.unassign': PAGE_FIX,
  'people.teachingAssignments.field.assignmentType': PAGE_FIX,
  'people.evaluations.action.completeAcr': PAGE_FIX,
  'people.evaluations.action.reopenAcr': PAGE_FIX,
  'people.calendar.action.regenerateFeed': PAGE_FIX,
  'people.programs.action.removeMilestone': PAGE_FIX,
  'people.admissionIntakes.action.add': PAGE_FIX,
  'people.admissionIntakes.field.classSection': PAGE_FIX,
  'people.admissionIntakes.field.seatCount': PAGE_FIX,
  'people.admissionIntakes.field.requiredDocuments': PAGE_FIX,
  'people.admissionIntakes.section.publicForm': PAGE_FIX,
  'people.admissionIntakes.section.status': PAGE_FIX,
  'people.admissionApplicants.action.shortlist': PAGE_FIX,
  'people.admissionApplicants.action.admit': PAGE_FIX,
  'people.admissionApplicants.action.reject': PAGE_FIX,
  'people.admissionApplicants.action.deleteDocuments': PAGE_FIX,
  'people.admissionReports.field.academicYear': PAGE_FIX,
  'people.admissionReports.field.class': PAGE_FIX,
  'academics.classes.action.deleteSection': PAGE_FIX,
  'academics.routineSetup.action.deleteShift': PAGE_FIX,
  'academics.routineBuilder.action.clearCell': PAGE_FIX,
  'academics.routineReview.action.requestChange': PAGE_FIX,
  'academics.routineReview.action.resolveRequest': PAGE_FIX,
  'academics.syllabus.action.deleteTopic': PAGE_FIX,
  'attendance.attendanceReports.action.sendReminder': PAGE_FIX,
  'reports.collectionsReport.field.preset': PAGE_FIX,
  'reports.collectionsReport.field.collector': PAGE_FIX,
  'reports.printables.action.reprint': PAGE_FIX,
  'reports.printables.action.revoke': PAGE_FIX,
  'reports.printables.action.printAdmitCards': PAGE_FIX,
  'reports.printables.action.printIdCards': PAGE_FIX,
  'reports.printables.action.exportRegister': PAGE_FIX,
  'reports.printables.field.revokeReason': PAGE_FIX,
  'reports.printables.field.validity': PAGE_FIX,
  'reports.applications.field.academicYear': PAGE_FIX,
  'reports.applications.field.submitted': PAGE_FIX,
};
