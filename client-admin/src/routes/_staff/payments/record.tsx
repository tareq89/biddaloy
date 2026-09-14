import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * `/payments/record` — [16.4.4] retired the six-step wizard this route
 * used to render. The route itself stays (dropping it would break
 * `_staff.tsx`'s nav item, `route-permissions.ts`'s entry, and
 * `route-permissions.test.ts`'s `NAV_PATH_TO_ROUTE_ID`) but now only
 * redirects to `/payments`, preserving `student_id` so the "Collect
 * fees" deep link from a student's page and the dues queue still land
 * with that student pre-selected rather than an empty modal.
 */
const recordPaymentSearchSchema = z.object({
  student_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/record')({
  validateSearch: recordPaymentSearchSchema,
  beforeLoad: ({ search }) => {
    const target =
      search.student_id !== undefined
        ? { record: '1' as const, student_id: search.student_id }
        : { record: '1' as const };
    // `redirect()` returns a `Redirect` (extends `Error`); the type-aware rule loses that
    // through this call's `search` generic, same shape as every other `throw redirect(...)`
    // in this codebase.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/payments', search: target });
  },
});
