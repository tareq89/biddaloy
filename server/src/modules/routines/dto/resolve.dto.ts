import { IsUUID, IsOptional, IsDateString, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `GET /routines/resolve` query — exactly one of `section_id`,
 * `teacher_id`, `student_id` identifies who the caller wants slots for
 * (D14). `ResolveRoutineService` throws if none or more than one is set.
 */
export class ResolveRoutineQueryDto {
  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsUUID()
  teacher_id?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  /** `BREAK` slots are excluded from teaching results by default; set
   * this to include them for grid display. `@Type(() => Boolean)` would
   * coerce the non-empty string `"false"` to `true` — parse the two
   * accepted string values explicitly instead. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsIn([true, false])
  include_breaks?: boolean;
}

/** One resolved, dated slot — a concrete "this happens on this date"
 * answer, with recurrence, effective dating and substitutions already
 * applied. */
export interface ResolvedSlot {
  date: string;
  routine_slot_id: string;
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  room_id: string | null;
  kind: string;
  teacher_ids: string[];
  substituted: boolean;
  cancelled: boolean;
  /** Set only when `substituted` is true. */
  substitute_teacher_id?: string;
  /** Set only when this date's result came from a teacher covering
   * someone else's slot (D18) rather than their own assignment. */
  covering_for_teacher_ids?: string[];
}
