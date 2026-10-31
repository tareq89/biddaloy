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
/** A DataTable row action: no helpId slot there, and a (?) on every row is noise (D18). */
const UI_SLOT = '#3316: DataTable row action, no helpId slot in ui/';

/** A per-card radio group: one (?) per period card is noise, where the single (?) goes is open. */
const PER_CARD = '#3313: per-period-card control, no single element for the (?)';

/** A More-menu action that runs at once and opens no dialog to hold the (?). */
const NO_DIALOG = '#3316: More-menu action runs at once, no dialog, so no (?) here';

/** A per-row control in a list; a (?) on every row is noise (D18), and no dialog opens. */
const ROW_CONTROL = '#3316: per-row control, no dialog to hold the (?)';

export const HELP_UNWIRED: Record<string, string> = {
  'start.signIn': PUBLIC,
  'start.signIn.action.submit': PUBLIC,
  'start.signIn.field.identifier': PUBLIC,
  'admin.createSchool': PUBLIC,
  'admin.createSchool.action.continue': PUBLIC,
  'admin.createSchool.action.verify': PUBLIC,

  // 44.3.01-44.3.06
  'people.staff.action.view': UI_SLOT,
  'people.staff.action.restore': UI_SLOT,
  'academics.syllabus.action.copyToMine': UI_SLOT,
  'people.evaluations.action.completeAcr': PAGE_FIX,
  'people.evaluations.action.reopenAcr': PAGE_FIX,
  'people.calendar.action.regenerateFeed': PAGE_FIX,
  'people.programs.action.removeMilestone': PAGE_FIX,
  'academics.routineBuilder.action.clearCell': PAGE_FIX,
  'academics.routineReview.action.requestChange': PAGE_FIX,
  'academics.routineReview.action.resolveRequest': PAGE_FIX,
  'attendance.attendanceReports.action.sendReminder': PAGE_FIX,
  'people.programs.action.archive': NO_DIALOG,
  'people.students.action.printIdCard': NO_DIALOG,

  // 44.3.07-44.3.11
  'portal.notifications.action.close': ROW_CONTROL,
  'portal.notifications.action.snooze': ROW_CONTROL,

  // 44.3.12: declared in the guide after the wave-3 pass ran

  // Help text written, (?) not wired: needs a placement call
  'academics.myRoutine.field.lessonStatus': PER_CARD,
};
