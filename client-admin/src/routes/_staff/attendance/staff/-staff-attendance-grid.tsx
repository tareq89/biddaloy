/**
 * [36.4] One row per staff member, a single `AttendanceStatusControl` per
 * row for the selected date — reuses [9.6]'s component so staff attendance
 * looks and behaves like the student register rather than inventing a
 * second status widget. Keyboard model is deliberately smaller than
 * `-roster-marker.tsx`'s own (no roving tabindex/arrow keys): the ticket
 * only asks for native `Tab` order plus `Enter` = PRESENT and `l` = LEAVE
 * on the focused row.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { AttendanceStatusControl } from '@biddaloy/ui/components';
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

  return (
    <>
      {/* Phone layout: same row markup, stacked full-width below the
          `sm` breakpoint via `flex-col`/`sm:flex-row` rather than a
          second accordion component — the row already collapses to one
          per-staff block, which is what an accordion would render anyway. */}
      <ul className="flex flex-col gap-1.5" aria-label={t('grid.title')}>
        {staff.map((user, index) => {
          const status = draft[user.staff_profile_id ?? ''] ?? null;
          if (user.staff_profile_id == null) return null;
          const staffProfileId = user.staff_profile_id;
          return (
            <li key={user.id}>
              <div
                className="flex min-h-14 flex-col items-start gap-2 rounded-lg border border-border-subtle bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`staff-attendance-row-${index}`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onKeyDown={(event) => handleRowKeyDown(event, staffProfileId)}
                  className="rounded-md text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {user.full_name}
                </button>
                <AttendanceStatusControl
                  value={status}
                  onChange={(next) => onStatusChange(staffProfileId, next)}
                  disabled={disabled}
                  studentName={user.full_name}
                  variant="expanded"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
