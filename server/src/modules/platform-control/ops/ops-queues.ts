import { ABSENCE_NOTICE_SWEEP_QUEUE } from '../../attendance/absence-notice.scheduler';
import { ATTENDANCE_SERIES_QUEUE } from '../../attendance/attendance-series.scheduler';
import { DEVICE_ABSENT_SWEEP_QUEUE } from '../../attendance/device-absent-sweep.scheduler';
import { INVITATION_BATCH_QUEUE } from '../../account-access/invitation-batch.constants';
import { ATTENTION_DELIVERY_QUEUE, ATTENTION_QUEUE } from '../../attention/attention.constants';
import { REFRESH_TOKEN_CLEANUP_QUEUE } from '../../auth/refresh-token-cleanup.constants';
import { BKASH_RECONCILE_QUEUE } from '../../billing/bkash/bkash.reconciler';
import { BILLING_QUEUE } from '../../billing/billing.scheduler';
import { IDLE_QUEUE } from '../../billing/idle-account.scheduler';
import {
  COMMUNICATIONS_QUEUE,
  FEE_NOTIFY_QUEUE,
} from '../../communications/communications.constants';
import { DASHBOARD_DIGEST_QUEUE } from '../../dashboard/digest/digest.constants';
import { AT_RISK_QUEUE } from '../../dashboard/insights/at-risk.constants';
import { FEES_DAILY_QUEUE } from '../../fees/fees.constants';
import { HOMEWORK_DEFAULTER_SWEEP_QUEUE } from '../../homework/homework-defaulter.scheduler';
import { INCIDENT_NOTIFY_QUEUE } from '../../incidents/incident-notify.listener';
import { REPORT_SCHEDULE_QUEUE } from '../../reports/delivery/report-schedules.service';
import {
  REPORT_EXPORT_CLEANUP_QUEUE,
  REPORT_EXPORT_QUEUE,
} from '../../reports/export/report-export.queue';
import { STUDY_PLAN_AUTO_DELIVERIES_QUEUE } from '../../study-plans/study-plan-auto-deliveries.scheduler';
import { STUDY_PLAN_FLAGS_QUEUE } from '../../study-plans/study-plan-flags.scheduler';
import { CUSTOM_DOMAIN_QUEUE } from '../../website/custom-domain.processor';
import { WORKBOOK_EXPORT_QUEUE } from '../../workbook/export/export.constants';
import { WORKBOOK_RESTORE_QUEUE } from '../../workbook/restore/restore.constants';
import { BACKUP_SCHEDULE_QUEUE } from '../../workbook/schedule/backup-schedule.constants';

/**
 * [Epic 99 D8] The allow-list of queue names the cockpit may read or retry. The route accepts
 * only these; `ops-queues.spec.ts` fails when a `registerQueue` name is missing from here.
 */
export const OPS_QUEUES: readonly string[] = [
  ABSENCE_NOTICE_SWEEP_QUEUE,
  ATTENDANCE_SERIES_QUEUE,
  ATTENTION_DELIVERY_QUEUE,
  ATTENTION_QUEUE,
  AT_RISK_QUEUE,
  BACKUP_SCHEDULE_QUEUE,
  BILLING_QUEUE,
  BKASH_RECONCILE_QUEUE,
  COMMUNICATIONS_QUEUE,
  CUSTOM_DOMAIN_QUEUE,
  DASHBOARD_DIGEST_QUEUE,
  DEVICE_ABSENT_SWEEP_QUEUE,
  FEES_DAILY_QUEUE,
  FEE_NOTIFY_QUEUE,
  HOMEWORK_DEFAULTER_SWEEP_QUEUE,
  IDLE_QUEUE,
  INCIDENT_NOTIFY_QUEUE,
  INVITATION_BATCH_QUEUE,
  REFRESH_TOKEN_CLEANUP_QUEUE,
  REPORT_EXPORT_CLEANUP_QUEUE,
  REPORT_EXPORT_QUEUE,
  REPORT_SCHEDULE_QUEUE,
  STUDY_PLAN_AUTO_DELIVERIES_QUEUE,
  STUDY_PLAN_FLAGS_QUEUE,
  WORKBOOK_EXPORT_QUEUE,
  WORKBOOK_RESTORE_QUEUE,
];
