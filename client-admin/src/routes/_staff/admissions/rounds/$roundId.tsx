/** Admission desk route — one round's work screen. Stub until its screen ticket (#2204 D11). */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AdmissionDesk } from '../../../../features/admission/desk/AdmissionDesk';
import { loadRouteNamespaces } from '../../../../route-loaders';

/** `?step=` picks the open panel; an unknown value falls back to the step with work left. */
const searchSchema = z.object({
  step: z.string().optional().catch(undefined),
  // The applicants list (useListUrlState) reads its filters from this validated schema; coerced
  // because TanStack parses `?search=123` as a number.
  search: z.coerce.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
});

/** Keyed by round so moving between desks remounts it and drops open dialogs, pages, queues. */
function RoundDesk() {
  const { roundId } = Route.useParams();
  return <AdmissionDesk key={roundId} />;
}

export const Route = createFileRoute('/_staff/admissions/rounds/$roundId')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('admission-desk', 'admission-stages', 'common'),
  component: RoundDesk,
});
