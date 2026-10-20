import { describe, expect, it } from 'vitest';
import { lessonDeliveriesTab, type LessonDeliveryRow } from './academics/lesson-deliveries.tab';
import { seatAllocationsTab, type SeatAllocationRow } from './exams/seat-allocations.tab';
import { leaveRecordTab, type LeaveRecordRow } from './hr/leave-record.tab';
import {
  milestoneAchievementsTab,
  type MilestoneAchievementRow,
} from './programs/milestone-achievements.tab';
import {
  routineChangeRequestsTab,
  type RoutineChangeRequestRow,
} from './routines/routine-change-requests.tab';

const ID = '11111111-1111-4111-8111-111111111111';
const USER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// #2687 (D12): a blank actor cell clears the stored actor when that actor is a
// current member (the export would have written their key), and keeps it when
// they have left (the export writes a blank for them). The loader sets
// `<col>_key` on each entity: '' means "departed".
interface Case {
  name: string;
  field: string;
  diff: (row: any, existing: any) => string[];
  // Row and entity are equal on everything except the actor.
  base: { row: object; existing: object; actorRow: string; actorEntity: string; keyProp: string };
}

const seat: Case = {
  name: 'seat_allocations.invigilator',
  field: 'invigilator',
  diff: (r: SeatAllocationRow, e: any) => seatAllocationsTab.diffFields(r, e),
  base: {
    row: {
      seat_plan_id: ID,
      exam_schedule_id: ID,
      student_id: ID,
      room_id: ID,
      seat_number: '1',
    },
    existing: {
      seat_plan_id: ID,
      exam_schedule_id: ID,
      student_id: ID,
      room_id: ID,
      seat_number: '1',
    },
    actorRow: 'invigilator_user_id',
    actorEntity: 'invigilator_user_id',
    keyProp: 'invigilator_key',
  },
};

const lesson: Case = {
  name: 'lesson_deliveries.recorded_by',
  field: 'recorded_by',
  diff: (r: LessonDeliveryRow, e: any) => lessonDeliveriesTab.diffFields(r, e),
  base: {
    row: {
      subject_id: ID,
      status: 'DELIVERED',
      reason: null,
      note: null,
      is_extra: false,
      auto: false,
    },
    existing: {
      subject_id: ID,
      status: 'DELIVERED',
      reason: null,
      note: null,
      is_extra: false,
      auto: false,
    },
    actorRow: 'recorded_by_user_id',
    actorEntity: 'recorded_by_user_id',
    keyProp: 'recorded_by_key',
  },
};

const leave: Case = {
  name: 'leave_record.approved_by',
  field: 'approved_by',
  diff: (r: LeaveRecordRow, e: any) => leaveRecordTab.diffFields(r, e),
  base: {
    row: {
      staff_profile_id: ID,
      leave_type: 'CASUAL',
      start_date: '2026-01-01',
      end_date: '2026-01-01',
      days: 1,
      status: 'APPROVED',
      reason: null,
      application_id: null,
      decided_at: null,
    },
    existing: {
      staff_profile_id: ID,
      leave_type: 'CASUAL',
      start_date: '2026-01-01',
      end_date: '2026-01-01',
      days: 1,
      status: 'APPROVED',
      reason: null,
      application_id: null,
      decided_at: null,
    },
    actorRow: 'approved_by',
    actorEntity: 'approved_by',
    keyProp: 'approved_by_key',
  },
};

const milestone: Case = {
  name: 'milestone_achievements.recorded_by',
  field: 'recorded_by',
  diff: (r: MilestoneAchievementRow, e: any) => milestoneAchievementsTab.diffFields(r, e),
  base: {
    row: { achieved_on: '2026-01-01', score: null, grade: null, remark: null },
    existing: { achieved_on: '2026-01-01', score: null, grade: null, remark: null },
    actorRow: 'recorded_by',
    actorEntity: 'recorded_by',
    keyProp: 'recorded_by_key',
  },
};

const change: Case = {
  name: 'routine_change_requests.resolved_by',
  field: 'resolved_by',
  diff: (r: RoutineChangeRequestRow, e: any) => routineChangeRequestsTab.diffFields(r, e),
  base: {
    row: {
      routine_slot_id: ID,
      requested_by: null,
      note: 'n',
      state: 'RESOLVED',
      resolved_at: null,
      resolution_note: null,
    },
    existing: {
      routine_slot_id: ID,
      requested_by: null,
      note: 'n',
      state: 'RESOLVED',
      resolved_at: null,
      resolution_note: null,
    },
    actorRow: 'resolved_by',
    actorEntity: 'resolved_by',
    keyProp: 'resolved_by_key',
  },
};

/** diffFields when the actor cell is blank and the stored actor is `stored` with key `key`. */
function blankCell(c: Case, stored: string | null, key: string): string[] {
  const { base } = c;
  const row = { ...base.row, [base.actorRow]: null };
  const existing = { ...base.existing, [base.actorEntity]: stored, [base.keyProp]: key };
  return c.diff(row, existing);
}

describe('diffFields: a blank actor cell clears a current actor only (#2687)', () => {
  describe(seat.name, () => {
    it('stored actor current: a blank cell is a change', () => {
      expect(blankCell(seat, USER, 'a@x')).toEqual([seat.field]);
    });
    it('stored actor departed: a blank cell is no change', () => {
      expect(blankCell(seat, USER, '')).toEqual([]);
    });
    it('stored null: a blank cell is no change', () => {
      expect(blankCell(seat, null, '')).toEqual([]);
    });
  });

  describe(lesson.name, () => {
    it('stored actor current: a blank cell is a change', () => {
      expect(blankCell(lesson, USER, 'a@x')).toEqual([lesson.field]);
    });
    it('stored actor departed: a blank cell is no change', () => {
      expect(blankCell(lesson, USER, '')).toEqual([]);
    });
    it('stored null: a blank cell is no change', () => {
      expect(blankCell(lesson, null, '')).toEqual([]);
    });
  });

  describe(leave.name, () => {
    it('stored actor current: a blank cell is a change', () => {
      expect(blankCell(leave, USER, 'a@x')).toEqual([leave.field]);
    });
    it('stored actor departed: a blank cell is no change', () => {
      expect(blankCell(leave, USER, '')).toEqual([]);
    });
    it('stored null: a blank cell is no change', () => {
      expect(blankCell(leave, null, '')).toEqual([]);
    });
  });

  describe(milestone.name, () => {
    it('stored actor current: a blank cell is a change', () => {
      expect(blankCell(milestone, USER, 'a@x')).toEqual([milestone.field]);
    });
    it('stored actor departed: a blank cell is no change', () => {
      expect(blankCell(milestone, USER, '')).toEqual([]);
    });
    it('stored null: a blank cell is no change', () => {
      expect(blankCell(milestone, null, '')).toEqual([]);
    });
  });

  describe(change.name, () => {
    it('stored actor current: a blank cell is a change', () => {
      expect(blankCell(change, USER, 'a@x')).toEqual([change.field]);
    });
    it('stored actor departed: a blank cell is no change', () => {
      expect(blankCell(change, USER, '')).toEqual([]);
    });
    it('stored null: a blank cell is no change', () => {
      expect(blankCell(change, null, '')).toEqual([]);
    });
  });
});
