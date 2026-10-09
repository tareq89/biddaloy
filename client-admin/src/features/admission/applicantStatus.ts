import { AdmissionApplicantStatus } from '@biddaloy/shared';
import { type StatusTone } from '@biddaloy/ui/components';

/** One tone + label key per applicant status, shared by the list and the detail screen. */
export const APPLICANT_STATUS: Record<
  AdmissionApplicantStatus,
  { tone: StatusTone; labelKey: string }
> = {
  [AdmissionApplicantStatus.PENDING]: { tone: 'warning', labelKey: 'list.statusPending' },
  [AdmissionApplicantStatus.SHORTLISTED]: { tone: 'info', labelKey: 'list.statusShortlisted' },
  [AdmissionApplicantStatus.ADMITTED]: { tone: 'success', labelKey: 'list.statusAdmitted' },
  [AdmissionApplicantStatus.REJECTED]: { tone: 'danger', labelKey: 'list.statusRejected' },
};
