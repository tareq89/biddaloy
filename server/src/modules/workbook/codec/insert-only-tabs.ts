/**
 * D13: a restore may add these rows but never change or remove one.
 * Corrections go through the app, where locks, approvals and per-row audit apply.
 */
export const INSERT_ONLY_TABS: ReadonlySet<string> = new Set([
  'payments',
  'payment_allocations',
  'student_fees',
  'invoices',
  'exams',
  'marks',
  'mark_grids',
  'results',
  'result_subjects',
]);
