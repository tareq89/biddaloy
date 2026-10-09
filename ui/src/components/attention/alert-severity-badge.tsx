import type { AlertSeverity } from '@biddaloy/shared';

import { StatusBadge } from '../status-badge';

export interface AlertSeverityBadgeProps {
  severity: AlertSeverity;
}

/** Urgent / Warning / Reminder: tone, label and a distinct icon shape per severity (D41). */
export function AlertSeverityBadge({ severity }: AlertSeverityBadgeProps) {
  return <StatusBadge domain="alertSeverity" status={severity} />;
}
