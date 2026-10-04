# Shared requests — lane attendance

- attendance_reports | `ui/src/shells/filter-bar.tsx` (31.2.7a `formatValue`) | also call `formatValue` for `kind: 'text'` chips (e.g. `formatValue('text', v)` or a per-field `formatChip?: (v: string) => string`), so a numeric text filter like "সর্বনিম্ন উপস্থিতি (%)" shows "৭৫" in its chip | the chip shows the typed value as is ("75" in Latin digits, D6 broken in that chip only)
- attendance_staff | `server/src/modules/staff-attendance` + `ui/src/api/staff-attendance.ts` | a `GET /staff-attendance/register?date=` (and a `useStaffAttendanceRegister(date)` hook) so the page can pre-fill marks already saved for that day | the page keeps starting every date unmarked; saving again overwrites the day (today's behaviour)
