import { IsISO8601, IsString, Matches } from 'class-validator';
import { CommunicationMedium, ReminderBatchStatus } from '@biddaloy/shared';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Body for both `POST .../absence-notice/preview` and `.../send`. */
export class AbsenceNoticeDateDto {
  @IsString()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  // `@Matches` only checks the shape — '2026-13-45' passes it and would
  // otherwise reach the Postgres date query as a 500 instead of a 400.
  @IsISO8601({ strict: true }, { message: 'date must be a real calendar date' })
  date: string;
}

/** One guardian a `send` would message — one row per guardian, not per
 * student, so a guardian with three absent children appears once. */
export class AbsenceNoticePreviewRecipientDto {
  guardian_id: string;
  guardian_name: string;
  medium: CommunicationMedium;
  address: string;
  student_ids: string[];
  student_names: string[];
  message_body: string;
}

/** A student (or one of their guardians) a `send` would leave out, and why. */
export class AbsenceNoticePreviewSkippedDto {
  student_id: string;
  guardian_id: string | null;
  reason: string;
}

export class AbsenceNoticePreviewResponseDto {
  /** `false` when no register exists yet for this section/date. */
  session_found: boolean;
  /** `false` for a `DRAFT` register — nothing is sent until it is finalized. */
  finalized: boolean;
  /** `true` once this session has already been notified; `send` would be a
   * no-op — see `AttendanceSession.notified_at`. */
  already_notified: boolean;
  recipients: AbsenceNoticePreviewRecipientDto[];
  skipped: AbsenceNoticePreviewSkippedDto[];
  /** The raw template — `recipients[].message_body` shows it already
   * rendered per guardian. */
  message_preview: string;
}

export class AbsenceNoticeSendResponseDto {
  /** `null` when nothing was sent (no session, not finalized, or already
   * notified — see `skipped_reason`). */
  batch_id: string | null;
  status: ReminderBatchStatus | null;
  total_recipients: number;
  skipped_reason: 'no_session' | 'not_finalized' | 'already_notified' | null;
}
