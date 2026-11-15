// Namespace for pg_advisory_xact_lock's two-key form, paired with hashtext(tenantId). Seat-plan
// publish/unpublish, exam-schedule moves and exam deletes all take it, so none can interleave.
export const SEAT_PLAN_PUBLISH_LOCK_NAMESPACE = 25_014;
