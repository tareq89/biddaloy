/**
 * [30.4.2] The other half of the action registry's contract.
 *
 * `action-registry.ts`'s `ACTIONS` list is a *complete* enumeration of
 * palette-reachable actions, not a "known so far" list - a shape guard
 * landing in #842 (wave-4 close) will refuse to let a new action be
 * added to `ACTIONS` without either shipping a real `run()` or being
 * accounted for here first. This file is that accounting: every dialog
 * in `client-admin/src/routes` that is NOT yet in `ACTIONS`, so nobody
 * has to grep the routes tree to find out what the palette is missing.
 *
 * Seeded from `rg -l '<Dialog|DialogContent' client-admin/src/routes`,
 * minus the files `ACTIONS`'s seeded entries reuse, on 2026-09-20 - then
 * widened to include each dialog's parent/index/detail page too (not just
 * the raw `rg` hit), since that's the page a reviewer would actually open
 * to find the dialog trigger. Every file below still exists on disk (see
 * `unregistered-actions.test.ts`), but this list is not a literal `rg`
 * diff - it is that plus readability additions.
 * `owningEpic: '31.0'` for all of these - every file listed here already
 * ships in `main` today, so wiring it into the palette is retrofit work
 * (Epic 31.0's stated job), not new feature work. Re-run the `rg` above
 * before trusting this list stale; it drifts as routes are added.
 *
 * Delete-your-lines protocol: when you register one of these files in
 * `action-registry.ts`, delete its entry here in the same commit - this
 * file growing without `ACTIONS` growing is the guard's other failure
 * mode.
 */

export interface UnregisteredAction {
  readonly file: string;
  readonly owningEpic: string;
  readonly note: string;
}

export const UNREGISTERED_ACTIONS: readonly UnregisteredAction[] = [
  {
    file: 'client-admin/src/routes/_platform/holiday-sets/$setId.tsx',
    owningEpic: '31.0',
    note: 'Holiday set detail - edit/delete dialogs for a single set',
  },
  {
    file: 'client-admin/src/routes/_platform/holiday-sets/-holiday-set-editor.tsx',
    owningEpic: '31.0',
    note: 'Holiday set create/edit form dialog',
  },
  {
    file: 'client-admin/src/routes/_platform/holiday-sets/index.tsx',
    owningEpic: '31.0',
    note: 'Holiday set list - create-set dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_platform/schools/$schoolId.tsx',
    owningEpic: '31.0',
    note: 'Platform school detail - status/workbook action dialogs',
  },
  {
    file: 'client-admin/src/routes/_platform/schools/-detail/admin-row.tsx',
    owningEpic: '31.0',
    note: 'School admin row - remove-admin confirm dialog',
  },
  {
    file: 'client-admin/src/routes/_platform/schools/-detail/restore-workbook-dialog.tsx',
    owningEpic: '31.0',
    note: 'Restore a school workbook from backup',
  },
  {
    file: 'client-admin/src/routes/_platform/schools/-detail/status-action-dialog.tsx',
    owningEpic: '31.0',
    note: 'Suspend/reactivate a school',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/$academicYearId.tsx',
    owningEpic: '31.0',
    note: 'Academic year detail - edit/delete dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/-delete-year-dialog.tsx',
    owningEpic: '31.0',
    note: 'Delete an academic year',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/-detail/terms-tab.tsx',
    owningEpic: '31.0',
    note: 'Term create/edit dialogs on the year detail page',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/-set-current-dialog.tsx',
    owningEpic: '31.0',
    note: 'Mark an academic year as current',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/-year-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit an academic year',
  },
  {
    file: 'client-admin/src/routes/_staff/academic-years/index.tsx',
    owningEpic: '31.0',
    note: 'Academic year list - create-year dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/attendance/$sectionId.tsx',
    owningEpic: '31.0',
    note: 'Section attendance marking - correction/conflict dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/attendance/-conflict-dialog.tsx',
    owningEpic: '31.0',
    note: 'Resolve a duplicate attendance mark conflict',
  },
  {
    file: 'client-admin/src/routes/_staff/attendance/-correction-dialog.tsx',
    owningEpic: '31.0',
    note: 'Correct an already-submitted attendance mark',
  },
  {
    file: 'client-admin/src/routes/_staff/attendance/reports.tsx',
    owningEpic: '31.0',
    note: 'Attendance reports - export/filter dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/calendar/-clone-dialog.tsx',
    owningEpic: '31.0',
    note: 'Clone a calendar event',
  },
  {
    file: 'client-admin/src/routes/_staff/calendar/-event-details-sheet.tsx',
    owningEpic: '31.0',
    note: 'Calendar event detail sheet',
  },
  {
    file: 'client-admin/src/routes/_staff/calendar/-event-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit a calendar event',
  },
  {
    file: 'client-admin/src/routes/_staff/calendar/-government-holidays-dialog.tsx',
    owningEpic: '31.0',
    note: 'Import government holidays',
  },
  {
    file: 'client-admin/src/routes/_staff/calendar/index.tsx',
    owningEpic: '31.0',
    note: 'Calendar - new-event dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/$classId.tsx',
    owningEpic: '31.0',
    note: 'Class detail - section/subject dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-attach-subject-dialog.tsx',
    owningEpic: '31.0',
    note: 'Attach a subject to a class',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-class-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit a class',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-delete-class-dialog.tsx',
    owningEpic: '31.0',
    note: 'Delete a class',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-delete-section-dialog.tsx',
    owningEpic: '31.0',
    note: 'Delete a section',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-detail/subjects-tab.tsx',
    owningEpic: '31.0',
    note: 'Class subjects tab - attach/remove dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-remove-subject-dialog.tsx',
    owningEpic: '31.0',
    note: 'Remove a subject from a class',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-section-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit a section',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/-sections-panel.tsx',
    owningEpic: '31.0',
    note: 'Class sections panel - section dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/classes/index.tsx',
    owningEpic: '31.0',
    note: 'Class list - create-class dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/communications/batches/$batchId.tsx',
    owningEpic: '31.0',
    note: 'Communication batch detail dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/fee-structures/-delete-structure-dialog.tsx',
    owningEpic: '31.0',
    note: 'Delete a fee structure',
  },
  {
    file: 'client-admin/src/routes/_staff/fee-structures/-structure-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit a fee structure',
  },
  {
    file: 'client-admin/src/routes/_staff/fee-structures/index.tsx',
    owningEpic: '31.0',
    note: 'Fee structure list - create dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/-generations/batch-actions.tsx',
    owningEpic: '31.0',
    note: 'Fee generation batch row actions',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/-generations/batch-bills-drawer.tsx',
    owningEpic: '31.0',
    note: 'Fee generation batch bills drawer',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/-generations/edit-batch-dialog.tsx',
    owningEpic: '31.0',
    note: 'Edit a fee generation batch',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/-generations/remove-student-dialog.tsx',
    owningEpic: '31.0',
    note: 'Remove a student from a fee batch',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/dues.tsx',
    owningEpic: '31.0',
    note: 'Fee dues list - collection dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/schedules/-clone-dialog.tsx',
    owningEpic: '31.0',
    note: 'Clone a recurring fee schedule',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/schedules/-schedule-form-dialog.tsx',
    owningEpic: '31.0',
    note: 'Create/edit a recurring fee schedule',
  },
  {
    file: 'client-admin/src/routes/_staff/fees/schedules/index.tsx',
    owningEpic: '31.0',
    note: 'Fee schedule list - create dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/guardians/$guardianId.tsx',
    owningEpic: '31.0',
    note: 'Guardian detail - edit dialog',
  },
  {
    file: 'client-admin/src/routes/_staff/guardians/-edit-guardian-dialog.tsx',
    owningEpic: '31.0',
    note: 'Edit a guardian',
  },
  {
    file: 'client-admin/src/routes/_staff/guardians/-invite-guardians-dialog.tsx',
    owningEpic: '31.0',
    note: 'Invite guardians',
  },
  {
    file: 'client-admin/src/routes/_staff/guardians/index.tsx',
    owningEpic: '31.0',
    note: 'Guardian list - invite dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/invoices/$invoiceId.tsx',
    owningEpic: '31.0',
    note: 'Invoice detail dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/payments/$id.tsx',
    owningEpic: '31.0',
    note: 'Payment detail - reverse-payment dialog',
  },
  {
    file: 'client-admin/src/routes/_staff/payments/-record/checkout-success.tsx',
    owningEpic: '31.0',
    note: 'Payment checkout success sheet',
  },
  {
    file: 'client-admin/src/routes/_staff/payments/-reverse-payment-dialog.tsx',
    owningEpic: '31.0',
    note: 'Reverse a recorded payment',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/$userId.tsx',
    owningEpic: '31.0',
    note: 'Staff detail - reset-password/remove dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-add-user-dialog.tsx',
    owningEpic: '31.0',
    note: 'Add/invite a staff member (local-state dialog, no standalone route yet - see header comment)',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-detail/invitation-card.tsx',
    owningEpic: '31.0',
    note: 'Staff invitation card - resend/revoke dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-detail/reset-password-dialog.tsx',
    owningEpic: '31.0',
    note: "Reset a staff user's password (local-state dialog, no standalone route yet)",
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-edit-teacher-dialog.tsx',
    owningEpic: '31.0',
    note: 'Edit a teacher profile',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-edit-user-dialog.tsx',
    owningEpic: '31.0',
    note: 'Edit a staff user',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-promote-teacher-dialog.tsx',
    owningEpic: '31.0',
    note: 'Promote a staff member to teacher',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/-remove-member-dialog.tsx',
    owningEpic: '31.0',
    note: 'Remove a staff member',
  },
  {
    file: 'client-admin/src/routes/_staff/staff/index.tsx',
    owningEpic: '31.0',
    note: 'Staff list - add-user dialog trigger',
  },
  {
    file: 'client-admin/src/routes/_staff/students/$studentId.tsx',
    owningEpic: '31.0',
    note: 'Student detail - transfer/delete dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-detail/-transfer-dialog.tsx',
    owningEpic: '31.0',
    note: 'Transfer a student to another class/section',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-detail/delete-student-dialog.tsx',
    owningEpic: '31.0',
    note: 'Delete a student',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-detail/discounts-section.tsx',
    owningEpic: '31.0',
    note: 'Student fee discounts - add/edit dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-detail/enrollment-tab.tsx',
    owningEpic: '31.0',
    note: 'Student enrollment tab dialogs',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-detail/transfer-status-dialog.tsx',
    owningEpic: '31.0',
    note: 'Student transfer status dialog',
  },
  {
    file: 'client-admin/src/routes/_staff/students/-send-reminder-dialog.tsx',
    owningEpic: '31.0',
    note: 'Send a fee reminder for one student (local-state dialog; the seeded action uses the standalone bulk-reminder route instead)',
  },
  {
    file: 'client-admin/src/routes/_staff/students/index.tsx',
    owningEpic: '31.0',
    note: 'Student list - send-reminder/delete dialog triggers',
  },
  {
    file: 'client-admin/src/routes/portal.tsx',
    owningEpic: '31.0',
    note: 'Guardian portal shell dialogs',
  },
  {
    file: 'client-admin/src/routes/portal/account.tsx',
    owningEpic: '31.0',
    note: 'Guardian portal account dialogs',
  },
  {
    file: 'client-admin/src/routes/portal/attendance.tsx',
    owningEpic: '31.0',
    note: 'Guardian portal attendance view dialogs',
  },
  {
    file: 'client-admin/src/routes/verify-email.tsx',
    owningEpic: '31.0',
    note: 'Email verification dialog',
  },
];
