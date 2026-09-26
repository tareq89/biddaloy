/**
 * [25.3] Seat allocation engine — pure functions over plain data, no
 * repository, no DI, no DB/HTTP concerns. Cloned in shape from
 * `../exams/result-rules.ts`: every function takes data in and returns data
 * out, and every rule here is tested from hand-built fixtures
 * (`allocation.spec.ts`). `seat-plans.service.ts` (#25.4, a sibling lane) is
 * the only caller that touches a database or HTTP.
 */

import { SeatOrderMode } from '@biddaloy/shared';

// --- Shared input shapes ---

export interface ScheduleInput {
  id: string;
  date: string; // 'YYYY-MM-DD'
  starts_at: string; // 'HH:mm[:ss]'
  ends_at: string; // 'HH:mm[:ss]'
}

/** One eligible student within one class/section, as seen by roster
 * computation — mirrors `Enrollment` joined to `Student`, not the full
 * entities. */
export interface EnrollmentInput {
  student_id: string;
  roll_number: number;
  section_id: string;
  class_id: string;
  /** Only `'ACTIVE'` enrollments are seatable — dropped/transferred/graduated
   * students are excluded regardless of section membership. */
  enrollment_status: string;
}

/** A class/section pair covered by one subject-sitting (`ExamSchedule`). */
export interface SectionInput {
  class_id: string;
  section_id: string;
}

export interface RoomInput {
  id: string;
  capacity: number;
}

// --- computeRoster (Step 2) ---

export interface RosterEntry {
  exam_schedule_id: string;
  student_id: string;
  roll_number: number;
  section_id: string;
}

/**
 * Flattens every ACTIVE enrollment in a subject-sitting's covered
 * class/sections into one seatable roster entry per (schedule, student).
 * Inactive/dropped enrollments never appear — capacity and allocation both
 * run only over students who are actually still enrolled.
 */
export function computeRoster(
  schedules: Array<{ schedule: ScheduleInput; sections: SectionInput[] }>,
  enrollments: EnrollmentInput[],
): RosterEntry[] {
  const roster: RosterEntry[] = [];
  for (const { schedule, sections } of schedules) {
    const coveredSections = new Set(sections.map((s) => `${s.class_id}:${s.section_id}`));
    for (const e of enrollments) {
      if (e.enrollment_status !== 'ACTIVE') continue;
      if (!coveredSections.has(`${e.class_id}:${e.section_id}`)) continue;
      roster.push({
        exam_schedule_id: schedule.id,
        student_id: e.student_id,
        roll_number: e.roll_number,
        section_id: e.section_id,
      });
    }
  }
  return roster;
}

// --- checkCapacity (Step 3, D4) ---

export interface CapacityShortfall {
  ok: false;
  seats_needed: number;
  seats_available: number;
  shortfall: number;
  /** Other rooms (not among `selectedRooms`) that could cover the gap,
   * largest free capacity first. */
  suggested_rooms: Array<{ room_id: string; capacity: number }>;
}

export interface CapacityOk {
  ok: true;
  seats_needed: number;
  seats_available: number;
}

/**
 * A room can be reused across subject-sittings that don't overlap in time
 * (e.g. morning and afternoon slots), so the real capacity requirement is
 * the largest seats-needed among schedules that DO overlap each other, not
 * the sum across every selected schedule. `schedules` lets the caller opt
 * into that grouping; when omitted (or empty), every schedule is treated as
 * one group and seats sum lump-sum, same as before.
 */
/**
 * Groups schedule ids into overlap-connected clusters — two schedules
 * without timing info (not in `scheduleById`) are conservatively assumed to
 * overlap with everything. Schedules in the same cluster compete for the
 * same room-time window and must be allocated together (one combined
 * `allocateSeats` pass); schedules in different clusters don't overlap in
 * time and may each independently reuse a room's full capacity. Shared by
 * `checkCapacity` (capacity math) and `SeatPlansService.generate` (the
 * actual seat assignment) so the two stay consistent — see #1059 review:
 * checkCapacity's clustering without a matching clustered allocation could
 * silently drop students from non-overlapping sittings into `unassigned`.
 */
export function clusterSchedules(
  scheduleIds: string[],
  scheduleById: Map<string, ScheduleInput>,
): string[][] {
  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const id of scheduleIds) {
    if (visited.has(id)) continue;
    const cluster = [id];
    visited.add(id);
    for (let i = 0; i < cluster.length; i++) {
      const current = scheduleById.get(cluster[i]);
      for (const other of scheduleIds) {
        if (visited.has(other)) continue;
        const otherSchedule = scheduleById.get(other);
        const bothTimed = current && otherSchedule;
        if (!bothTimed || overlaps(current, otherSchedule)) {
          visited.add(other);
          cluster.push(other);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export function checkCapacity(
  roster: RosterEntry[],
  selectedRooms: RoomInput[],
  allRooms: RoomInput[],
  schedules: ScheduleInput[] = [],
): CapacityOk | CapacityShortfall {
  const seats_available = selectedRooms.reduce((sum, r) => sum + r.capacity, 0);

  const neededByScheduleId = new Map<string, number>();
  for (const entry of roster) {
    neededByScheduleId.set(
      entry.exam_schedule_id,
      (neededByScheduleId.get(entry.exam_schedule_id) ?? 0) + 1,
    );
  }
  const scheduleIds = [...neededByScheduleId.keys()];
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

  const clusters = clusterSchedules(scheduleIds, scheduleById);
  const clusterNeeds = clusters.map((cluster) =>
    cluster.reduce((sum, cid) => sum + (neededByScheduleId.get(cid) ?? 0), 0),
  );
  const seats_needed = clusterNeeds.length ? Math.max(...clusterNeeds) : 0;

  if (seats_available >= seats_needed) {
    return { ok: true, seats_needed, seats_available };
  }

  const shortfall = seats_needed - seats_available;
  const selectedIds = new Set(selectedRooms.map((r) => r.id));
  const suggested_rooms = allRooms
    .filter((r) => !selectedIds.has(r.id) && r.capacity > 0)
    .sort((a, b) => b.capacity - a.capacity)
    .map((r) => ({ room_id: r.id, capacity: r.capacity }));

  return { ok: false, seats_needed, seats_available, shortfall, suggested_rooms };
}

// --- checkRoomConflicts (Step 4, D10) ---

export interface ExistingAllocationRoom {
  seat_plan_id: string;
  room_id: string;
  /** The date/time windows the existing PUBLISHED plan's schedules occupy
   * that room under. */
  schedules: ScheduleInput[];
}

export interface RoomConflict {
  room_id: string;
  conflicting_seat_plan_id: string;
  conflicting_schedule_id: string;
  schedule_id: string;
}

function toRange(s: ScheduleInput): { start: number; end: number } {
  const start = new Date(`${s.date}T${s.starts_at}`).getTime();
  const end = new Date(`${s.date}T${s.ends_at}`).getTime();
  return { start, end };
}

function overlaps(a: ScheduleInput, b: ScheduleInput): boolean {
  const ra = toRange(a);
  const rb = toRange(b);
  return ra.start < rb.end && rb.start < ra.end;
}

/**
 * For each room being planned now, does it already appear in another
 * PUBLISHED seat plan whose schedules' date/time overlap any schedule being
 * planned now? Returns structured conflicts — never throws. The caller
 * (#25.4) decides whether to hard-block or just warn.
 */
export function checkRoomConflicts(
  plannedRoomIds: string[],
  plannedSchedules: ScheduleInput[],
  existingPublishedAllocations: ExistingAllocationRoom[],
): RoomConflict[] {
  const plannedRoomSet = new Set(plannedRoomIds);
  const conflicts: RoomConflict[] = [];

  for (const existing of existingPublishedAllocations) {
    if (!plannedRoomSet.has(existing.room_id)) continue;
    for (const existingSchedule of existing.schedules) {
      for (const plannedSchedule of plannedSchedules) {
        if (overlaps(existingSchedule, plannedSchedule)) {
          conflicts.push({
            room_id: existing.room_id,
            conflicting_seat_plan_id: existing.seat_plan_id,
            conflicting_schedule_id: existingSchedule.id,
            schedule_id: plannedSchedule.id,
          });
        }
      }
    }
  }
  return conflicts;
}

// --- allocateSeats (Step 5, D2/D3) ---

export interface SeatAssignment {
  exam_schedule_id: string;
  student_id: string;
  room_id: string;
  seat_number: string;
}

/** Deterministic shuffle so RANDOM order is testable without mocking
 * `Math.random` — Fisher-Yates driven by a simple mulberry32 PRNG. */
function shuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = seed >>> 0;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Orders students within one subject-sitting's roster per `orderMode`
 * (D3): SEQUENTIAL by roll number, RANDOM shuffled. Order mode affects
 * which student gets which seat, never the seat-number format. */
function orderRoster(roster: RosterEntry[], orderMode: SeatOrderMode, seed: number): RosterEntry[] {
  if (orderMode === SeatOrderMode.RANDOM) {
    return shuffle(roster, seed);
  }
  return [...roster].sort((a, b) => a.roll_number - b.roll_number);
}

/** Groups an ordered roster by section, then round-robins across those
 * groups so a room is never filled one section at a time (D2 — no room
 * ends up single-section when 2+ sections and 2+ rooms are involved). */
function interleaveBySection(ordered: RosterEntry[]): RosterEntry[] {
  const bySection = new Map<string, RosterEntry[]>();
  for (const entry of ordered) {
    const list = bySection.get(entry.section_id) ?? [];
    list.push(entry);
    bySection.set(entry.section_id, list);
  }
  const groups = [...bySection.values()];
  const interleaved: RosterEntry[] = [];
  let remaining = ordered.length;
  const cursors = groups.map(() => 0);
  while (remaining > 0) {
    for (let g = 0; g < groups.length; g++) {
      if (cursors[g] < groups[g].length) {
        interleaved.push(groups[g][cursors[g]]);
        cursors[g]++;
        remaining--;
      }
    }
  }
  return interleaved;
}

/**
 * Distributes one subject-sitting's roster across the given rooms, filling
 * each room to capacity, sections interleaved within a room (D2), students
 * within a room ordered per `orderMode` (D3). `seed` makes RANDOM order
 * reproducible for tests; callers not testing determinism can pass
 * `Date.now()`.
 *
 * Caller is expected to have already checked capacity — rooms fill in the
 * order given and any roster overflow beyond total capacity is left
 * unassigned (returned in `unassigned`).
 */
export function allocateSeats(
  roster: RosterEntry[],
  rooms: RoomInput[],
  orderMode: SeatOrderMode,
  seed: number = 1,
): { assignments: SeatAssignment[]; unassigned: RosterEntry[] } {
  const ordered = orderRoster(roster, orderMode, seed);
  const interleaved = interleaveBySection(ordered);

  const assignments: SeatAssignment[] = [];
  let cursor = 0;
  for (const room of rooms) {
    for (let seat = 1; seat <= room.capacity && cursor < interleaved.length; seat++) {
      const entry = interleaved[cursor++];
      assignments.push({
        exam_schedule_id: entry.exam_schedule_id,
        student_id: entry.student_id,
        room_id: room.id,
        seat_number: String(seat),
      });
    }
  }
  const unassigned = interleaved.slice(cursor);
  return { assignments, unassigned };
}

// --- reshuffleRoom (Step 6, D9) ---

export interface ExistingSeatAssignment {
  exam_schedule_id: string;
  student_id: string;
  section_id: string;
  roll_number: number;
  room_id: string;
  seat_number: string;
}

/**
 * Re-runs allocation for just one room's students (D9's partial reshuffle,
 * used by #25.4/#25.7), leaving every other room's assignments untouched.
 */
export function reshuffleRoom(
  existingAllocation: ExistingSeatAssignment[],
  roomId: string,
  orderMode: SeatOrderMode,
  seed: number = 1,
): SeatAssignment[] {
  const untouched = existingAllocation.filter((a) => a.room_id !== roomId);
  const target = existingAllocation.filter((a) => a.room_id === roomId);
  if (target.length === 0) return untouched.map(toSeatAssignment);

  // A room can be shared by more than one subject-sitting (D1) — each
  // schedule seats its own students independently, so seat numbering must
  // restart per schedule rather than spanning the whole room's headcount.
  const byExamSchedule = new Map<string, ExistingSeatAssignment[]>();
  for (const a of target) {
    const group = byExamSchedule.get(a.exam_schedule_id) ?? [];
    group.push(a);
    byExamSchedule.set(a.exam_schedule_id, group);
  }

  const reshuffled: SeatAssignment[] = [];
  for (const group of byExamSchedule.values()) {
    const roster: RosterEntry[] = group.map((a) => ({
      exam_schedule_id: a.exam_schedule_id,
      student_id: a.student_id,
      roll_number: a.roll_number,
      section_id: a.section_id,
    }));
    const { assignments } = allocateSeats(
      roster,
      [{ id: roomId, capacity: group.length }],
      orderMode,
      seed,
    );
    reshuffled.push(...assignments);
  }

  return [...untouched.map(toSeatAssignment), ...reshuffled];
}

function toSeatAssignment(a: ExistingSeatAssignment): SeatAssignment {
  return {
    exam_schedule_id: a.exam_schedule_id,
    student_id: a.student_id,
    room_id: a.room_id,
    seat_number: a.seat_number,
  };
}
