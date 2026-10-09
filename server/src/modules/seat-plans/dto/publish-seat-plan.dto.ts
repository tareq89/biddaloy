/**
 * Body for `POST /seat-plans/:id/publish`. Empty for now — publish takes no
 * input, it's the plan's `:id` and current DRAFT state doing all the work.
 * Kept as its own class (rather than no body at all) so a future field
 * (e.g. a publish note) has an obvious home without touching the route.
 */
export class PublishSeatPlanDto {}
