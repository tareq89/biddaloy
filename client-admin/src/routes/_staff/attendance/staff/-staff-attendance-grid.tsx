/**
 * [36.4] One row per staff member, a single `AttendanceStatusControl` per
 * row for the selected date — reuses [9.6]'s component so staff attendance
 * looks and behaves like the student register rather than inventing a
 * second status widget. Keyboard model is deliberately smaller than
 * `-roster-marker.tsx`'s own (no roving tabindex/arrow keys): native `Tab`
 * order, `Enter` = PRESENT, `l` = LEAVE on the focused row, and a click
 * (or Space) on the name toggles PRESENT <-> ABSENT like the student roster.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { AttendanceStatusControl, StatusBadge } from '@biddaloy/ui/components';
import type { StaffUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type * as React from 'react';

export type StaffAttendanceDraft = Record<string, AttendanceStatus | null>;

export interface StaffAttendanceGridProps {
  staff: readonly StaffUser[];
  draft: StaffAttendanceDraft;
  onStatusChange: (staffProfileId: string, status: AttendanceStatus) => void;
  disabled?: boolean;
}

export function countStaffDraft(staff: readonly StaffUser[], draft: StaffAttendanceDraft) {
  const counts = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 };
  for (const user of staff) {
    const status = draft[user.staff_profile_id ?? ''] ?? null;
    if (status === AttendanceStatus.PRESENT) counts.present += 1;
    else if (status === AttendanceStatus.ABSENT) counts.absent += 1;
    else if (status === AttendanceStatus.LATE) counts.late += 1;
    else if (status === AttendanceStatus.LEAVE) counts.leave += 1;
    else counts.unmarked += 1;
  }
  return counts;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function StaffAttendanceGrid({
  staff,
  draft,
  onStatusChange,
  disabled = false,
}: StaffAttendanceGridProps) {
  const { t } = useTranslation('staffAttendance');

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, staffProfileId: string) {
    if (isTypingTarget(event.target) || disabled) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onStatusChange(staffProfileId, AttendanceStatus.PRESENT);
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      onStatusChange(staffProfileId, AttendanceStatus.LEAVE);
    }
  }

  const counts = countStaffDraft(staff, draft);

  return (
    <section
      aria-labelledby="staff-roster"
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
    >
      <h2 id="staff-roster" className="sr-only">
        {t('grid.rosterHeading')}
      </h2>
      <p className="flex flex-wrap gap-2 border-b border-border-subtle p-4 md:px-5">
        <StatusBadge tone="success" label={t('grid.countPresent', { n: counts.present })} />
        <StatusBadge tone="danger" label={t('grid.countAbsent', { n: counts.absent })} />
        <StatusBadge tone="warning" label={t('grid.countLate', { n: counts.late })} />
        <StatusBadge tone="info" label={t('grid.countLeave', { n: counts.leave })} />
        <StatusBadge tone="neutral" label={t('grid.countUnmarked', { n: counts.unmarked })} />
      </p>
      <ul className="divide-y divide-border-subtle" aria-label={t('grid.title')}>
        {staff.map((user, index) => {
          const status = draft[user.staff_profile_id ?? ''] ?? null;
          if (user.staff_profile_id == null) return null;
          const staffProfileId = user.staff_profile_id;
          return (
            <li
              key={user.id}
              className="flex min-h-14 items-center gap-3 px-4 py-1.5 md:px-5"
              data-testid={`staff-attendance-row-${index}`}
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onStatusChange(
                      staffProfileId,
                      status === AttendanceStatus.PRESENT
                        ? AttendanceStatus.ABSENT
                        : AttendanceStatus.PRESENT,
                    )
                  }
                  onKeyDown={(event) => handleRowKeyDown(event, staffProfileId)}
                  className="flex min-h-11 max-w-full items-center rounded-md text-start font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {user.full_name}
                </button>
                {user.role ? (
                  <span className="block truncate text-caption text-text-secondary">
                    {t(`roles.${user.role}`, { ns: 'staff' })}
                  </span>
                ) : null}
              </div>
              <AttendanceStatusControl
                value={status}
                onChange={(next) => onStatusChange(staffProfileId, next)}
                disabled={disabled}
                studentName={user.full_name}
              />
            </li>
          );
        })}
      </ul>
      {!disabled && (
        <p className="hidden border-t border-border-subtle px-5 py-3 text-caption text-text-secondary md:block">
          {t('grid.shortcutHint')}
        </p>
      )}
    </section>
  );
}
