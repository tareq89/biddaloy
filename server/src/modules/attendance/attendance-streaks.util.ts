import { AttendanceStatus } from '@biddaloy/shared';

export type StreakStatus =
  AttendanceStatus.ABSENT | AttendanceStatus.LATE | AttendanceStatus.PRESENT;

// ponytail: constants (D22); make a tenant setting when a school asks.
export const STREAK_THRESHOLDS: Record<StreakStatus, number> = {
  [AttendanceStatus.ABSENT]: 3,
  [AttendanceStatus.LATE]: 3,
  [AttendanceStatus.PRESENT]: 15,
};

/** Sessions the service must load: the longest run any threshold needs. */
export const MAX_STREAK_SESSIONS = Math.max(...Object.values(STREAK_THRESHOLDS));

export interface StreakSession {
  id: string;
  date: string;
}

export interface Streak {
  student_id: string;
  status: StreakStatus;
  length: number;
  /** Date of the oldest day-session in the run. */
  since_date: string;
}

/**
 * Current run per student, counted back from the newest day-session. The run
 * status is the status at the newest session; any other status (LEAVE and a
 * missing record included) ends it. Dates with no session never appear in
 * `sessionsNewestFirst`, so holidays skip naturally. A run is returned only
 * when it reaches its status's threshold.
 *
 * `statusBySession`: student id -> (session id -> status).
 */
export function currentStreaks(
  sessionsNewestFirst: StreakSession[],
  studentIds: string[],
  statusBySession: Map<string, Map<string, AttendanceStatus>>,
): Streak[] {
  if (sessionsNewestFirst.length === 0) return [];
  const out: Streak[] = [];
  for (const studentId of studentIds) {
    const marks = statusBySession.get(studentId);
    const first = marks?.get(sessionsNewestFirst[0].id);
    if (!marks || !first || !(first in STREAK_THRESHOLDS)) continue;
    let length = 0;
    for (const s of sessionsNewestFirst) {
      if (marks.get(s.id) !== first) break;
      length++;
    }
    if (length >= STREAK_THRESHOLDS[first as StreakStatus]) {
      out.push({
        student_id: studentId,
        status: first as StreakStatus,
        length,
        since_date: sessionsNewestFirst[length - 1].date,
      });
    }
  }
  return out;
}
