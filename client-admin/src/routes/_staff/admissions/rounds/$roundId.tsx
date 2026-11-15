/** Admission desk route — one round's work screen. Stub until its screen ticket (#2204 D11). */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AdmissionDesk } from '../../../../features/admission/desk/AdmissionDesk';
import { loadRouteNamespaces } from '../../../../route-loaders';

/** `?step=` picks the open panel; an unknown value falls back to the step with work left. */
const searchSchema = z.object({ step: z.string().optional().catch(undefined) });

export const Route = createFileRoute('/_staff/admissions/rounds/$roundId')({
  validateSearch: searchSchema,
  loader: () =>
    loadRouteNamespaces('admission-desk', 'admission-stages', 'admission-lists', 'common'),
  component: AdmissionDesk,
});
