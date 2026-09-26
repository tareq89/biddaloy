// BRIDGING STUB pending #1052's canonical implementation — integration will reconcile with the real allocation.ts from epic/787/w2-g1-01-allocation
import { SeatOrderMode } from '@biddaloy/shared';

/**
 * Pure allocation helpers for seat-plan generation (#25.3's engine). This
 * is a bridging stub written by #25.4 so its service/tests have something
 * real to call against — #1052 (sibling ticket, parallel branch) owns the
 * canonical implementation and lands with its own `allocation.spec.ts`.
 * The function signatures here match #1052's spec; #25.4's service only
 * depends on these shapes, so integration should be a drop-in swap.
 */

export interface EnrolledStudent {
  id: string;
  roll_number: number;
  section_id: string | null;
}

export interface RosterEntry {
  exam_schedule_id: string;
  student: EnrolledStudent;
}

export interface ScheduleInput {
  id: string;
  section_ids: string[];
}

export interface SectionInput {
  id: string;
  students: EnrolledStudent[];
}

export interface RoomInput {
  id: string;
  capacity: number;
}

export interface CapacityShortfall {
  ok: false;
  seats_needed: number;
  seats_available: number;
  shortfall: number;
  suggested_rooms: { room_id: string; free_capacity: number }[];
}

export type CapacityResult = { ok: true } | CapacityShortfall;

export interface RoomConflict {
  room_id: string;
  conflicting_seat_plan_id: string;
  exam_schedule_id: string;
}

export interface ExistingPublishedAllocation {
  seat_plan_id: string;
  room_id: string;
  exam_schedule_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
}

export interface ScheduleWithTiming extends ScheduleInput {
  date: string;
  starts_at: string;
  ends_at: string;
}

export interface SeatAssignment {
  exam_schedule_id: string;
  student_id: string;
  room_id: string;
  seat_number: string;
}

/** Flat roster: every active student, per subject-sitting, across the given sections. */
export function computeRoster(schedules: ScheduleInput[], sections: SectionInput[]): RosterEntry[] {
  const sectionsById = new Map(sections.map((s) => [s.id, s]));
  const roster: RosterEntry[] = [];
  for (const schedule of schedules) {
    for (const sectionId of schedule.section_ids) {
      const section = sectionsById.get(sectionId);
      if (!section) continue;
      for (const student of section.students) {
        roster.push({ exam_schedule_id: schedule.id, student });
      }
    }
  }
  return roster;
}

/** Total roster size vs total room capacity; structured shortfall + suggestions on failure. */
export function checkCapacity(roster: RosterEntry[], rooms: RoomInput[]): CapacityResult {
  const seatsNeeded = roster.length;
  const seatsAvailable = rooms.reduce((sum, r) => sum + r.capacity, 0);
  if (seatsNeeded <= seatsAvailable) {
    return { ok: true };
  }
  return {
    ok: false,
    seats_needed: seatsNeeded,
    seats_available: seatsAvailable,
    shortfall: seatsNeeded - seatsAvailable,
    // ponytail: no "other available rooms" pool passed in yet — suggestion
    // list is empty until #1052's real impl wires in the tenant's spare rooms.
    suggested_rooms: [],
  };
}

/** Rooms already used by another PUBLISHED plan with an overlapping schedule date/time. Never throws. */
export function checkRoomConflicts(
  rooms: RoomInput[],
  schedules: ScheduleWithTiming[],
  existingPublishedAllocations: ExistingPublishedAllocation[],
): RoomConflict[] {
  const roomIds = new Set(rooms.map((r) => r.id));
  const conflicts: RoomConflict[] = [];
  for (const existing of existingPublishedAllocations) {
    if (!roomIds.has(existing.room_id)) continue;
    const overlapsAny = schedules.some(
      (s) => s.date === existing.date && s.starts_at < existing.ends_at && existing.starts_at < s.ends_at,
    );
    if (overlapsAny) {
      conflicts.push({
        room_id: existing.room_id,
        conflicting_seat_plan_id: existing.seat_plan_id,
        exam_schedule_id: existing.exam_schedule_id,
      });
    }
  }
  return conflicts;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Order roster entries by roll number (SEQUENTIAL) or shuffled (RANDOM), interleaved round-robin by section. */
function orderRoster(roster: RosterEntry[], orderMode: SeatOrderMode): RosterEntry[] {
  const bySection = new Map<string, RosterEntry[]>();
  for (const entry of roster) {
    const key = entry.student.section_id ?? '__none__';
    const list = bySection.get(key) ?? [];
    list.push(entry);
    bySection.set(key, list);
  }
  const sectionLists = [...bySection.values()].map((list) =>
    orderMode === SeatOrderMode.RANDOM
      ? shuffle(list)
      : [...list].sort((a, b) => a.student.roll_number - b.student.roll_number),
  );

  const ordered: RosterEntry[] = [];
  let remaining = sectionLists.some((list) => list.length > 0);
  let cursor = 0;
  while (remaining) {
    remaining = false;
    for (const list of sectionLists) {
      const item = list[cursor];
      if (item) {
        ordered.push(item);
        remaining = true;
      }
    }
    cursor++;
  }
  return ordered;
}

/** Distributes roster across rooms to capacity, interleaving sections round-robin, no room single-section. */
export function allocateSeats(roster: RosterEntry[], rooms: RoomInput[], orderMode: SeatOrderMode): SeatAssignment[] {
  const ordered = orderRoster(roster, orderMode);
  const assignments: SeatAssignment[] = [];
  let roomIndex = 0;
  let seatInRoom = 1;

  for (const entry of ordered) {
    // Move to the next room once the current one is full.
    while (roomIndex < rooms.length && seatInRoom > rooms[roomIndex].capacity) {
      roomIndex++;
      seatInRoom = 1;
    }
    if (roomIndex >= rooms.length) {
      // Should not happen if checkCapacity passed first, but don't silently drop students.
      throw new Error('Ran out of room capacity during allocation');
    }
    assignments.push({
      exam_schedule_id: entry.exam_schedule_id,
      student_id: entry.student.id,
      room_id: rooms[roomIndex].id,
      seat_number: String(seatInRoom),
    });
    seatInRoom++;
  }
  return assignments;
}

/** Re-runs allocation for just one room's students, without touching other rooms. */
export function reshuffleRoom(
  existingAllocation: SeatAssignment[],
  roomId: string,
  orderMode: SeatOrderMode,
): SeatAssignment[] {
  const roomAssignments = existingAllocation.filter((a) => a.room_id === roomId);
  const others = existingAllocation.filter((a) => a.room_id !== roomId);
  const roster: RosterEntry[] = roomAssignments.map((a) => ({
    exam_schedule_id: a.exam_schedule_id,
    student: { id: a.student_id, roll_number: 0, section_id: null },
  }));
  // Roll number isn't available from a bare allocation row, so RANDOM is the
  // only meaningfully different reshuffle here; SEQUENTIAL keeps stable
  // input order. #1052's real impl carries roll numbers through.
  const ordered = orderMode === SeatOrderMode.RANDOM ? shuffle(roster) : roster;
  const reassigned = ordered.map((entry, idx) => ({
    exam_schedule_id: entry.exam_schedule_id,
    student_id: entry.student.id,
    room_id: roomId,
    seat_number: String(idx + 1),
  }));
  return [...others, ...reassigned];
}
