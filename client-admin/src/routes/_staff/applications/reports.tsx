import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ApplicationsReports } from './-reports/applications-reports';

/** [52.4.1] Search keys; filters live in the URL so a filtered report is shareable. */
const reportsSearchSchema = z.object({
  academic_year_id: z.string().uuid().optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/reports')({
  validateSearch: reportsSearchSchema,
  loader: () =>
    loadRouteNamespaces('applications', 'applicationsReports', 'common', 'leave', 'nav'),
  component: ApplicationsReports,
});
