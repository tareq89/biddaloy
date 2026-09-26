import type { EntityManager } from 'typeorm';
import { MilestoneAchievement } from '../../../programs/entities/milestone-achievement.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { programEnrollmentsTab } from './program-enrollments.tab';
import { programMilestonesTab } from './program-milestones.tab';

/**
 * The `milestone_achievements` tab (Epic 34.0, [34.1.4]): a student's
 * achievement of one `ProgramMilestone` within their `ProgramEnrollment`.
 * `enrollment_id`/`milestone_id` are raw UUIDs, not natural keys on their
 * own, so this tab refs both `program_enrollments` and `program_milestones`
 * (each already keyed by its own readable natural key) and combines them:
 * `enrollment|milestone`, which reduces to
 * `program|student|started_on|program|sequence` once both refs are
 * resolved to their own natural keys — unique because the DB itself only
 * allows one row per (enrollment, milestone).
 */
export interface MilestoneAchievementRow {
  id: string;
  enrollment_id: string;
  milestone_id: string;
  achieved_on: string;
  recorded_by: string | null;
  score: string | null;
  grade: string | null;
  remark: string | null;
  enrollment_key: string;
  milestone_key: string;
  recorded_by_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'enrollment',
    type: 'ref',
    ref: 'program_enrollments',
    required: true,
    label: { en: 'Enrollment', bn: 'ভর্তি' },
  },
  {
    key: 'milestone',
    type: 'ref',
    ref: 'program_milestones',
    required: true,
    label: { en: 'Milestone', bn: 'মাইলফলক' },
  },
  {
    key: 'achieved_on',
    type: 'date',
    required: true,
    label: { en: 'Achieved on', bn: 'অর্জনের তারিখ' },
  },
  {
    key: 'recorded_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Recorded by', bn: 'রেকর্ডকারী' },
  },
  { key: 'score', type: 'money', label: { en: 'Score', bn: 'স্কোর' } },
  { key: 'grade', type: 'string', label: { en: 'Grade', bn: 'গ্রেড' } },
  { key: 'remark', type: 'string', label: { en: 'Remark', bn: 'মন্তব্য' } },
];

const excluded: readonly string[] = [
  'enrollment_id', // exported instead as the `enrollment` ref column
  'milestone_id', // exported instead as the `milestone` ref column
  // `recorded_by` is not excluded: it's declared directly as a `ref` column
  // above (the entity property and the column key share the same name).
];

export const milestoneAchievementsTab: TabSpec<MilestoneAchievement, MilestoneAchievementRow> = {
  name: 'milestone_achievements',
  entity: MilestoneAchievement,
  excluded,
  dependsOn: ['program_enrollments', 'program_milestones', 'users'],
  columns,
  naturalKey: ['enrollment', 'milestone'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<MilestoneAchievement[]> {
    return m.find(MilestoneAchievement, {
      where: { tenant_id: tenantId },
      relations: [
        'enrollment',
        'enrollment.program',
        'enrollment.student',
        'milestone',
        'milestone.program',
        'recorded_by_user',
      ],
    });
  },

  toRow(entity: MilestoneAchievement, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      enrollment: ctx.keyOf('program_enrollments', entity.enrollment_id),
      milestone: ctx.keyOf('program_milestones', entity.milestone_id),
      achieved_on: entity.achieved_on,
      recorded_by: entity.recorded_by ? ctx.keyOf('users', entity.recorded_by) : null,
      score: entity.score,
      grade: entity.grade,
      remark: entity.remark,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: MilestoneAchievementRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'milestone_achievements', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const enrollmentKey = values.enrollment as string;
    const enrollmentId = ctx.ref('program_enrollments', enrollmentKey);
    if (!enrollmentId) {
      errors.push({
        tab: 'milestone_achievements',
        row: rowNo,
        column: 'enrollment',
        message: `Column "enrollment": no program enrollment "${enrollmentKey}" was found.`,
        severity: 'error',
        value: enrollmentKey,
      });
    }

    const milestoneKey = values.milestone as string;
    const milestoneId = ctx.ref('program_milestones', milestoneKey);
    if (!milestoneId) {
      errors.push({
        tab: 'milestone_achievements',
        row: rowNo,
        column: 'milestone',
        message: `Column "milestone": no program milestone "${milestoneKey}" was found.`,
        severity: 'error',
        value: milestoneKey,
      });
    }

    if (errors.length > 0) return { errors };

    const recordedByKey = (values.recorded_by as string | null) ?? '';
    let recordedById: string | null = null;
    if (recordedByKey) {
      const resolved = ctx.ref('users', recordedByKey);
      if (!resolved) {
        errors.push({
          tab: 'milestone_achievements',
          row: rowNo,
          column: 'recorded_by',
          message: `Column "recorded_by": no user with email "${recordedByKey}" was found.`,
          severity: 'error',
          value: recordedByKey,
        });
      } else {
        recordedById = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        enrollment_id: enrollmentId as string,
        milestone_id: milestoneId as string,
        achieved_on: values.achieved_on as string,
        recorded_by: recordedById,
        score: (values.score as string | null) ?? null,
        grade: (values.grade as string | null) ?? null,
        remark: (values.remark as string | null) ?? null,
        enrollment_key: enrollmentKey,
        milestone_key: milestoneKey,
        recorded_by_key: recordedByKey,
      },
    };
  },

  keyOf(x: MilestoneAchievementRow | MilestoneAchievement): string {
    const enrollmentKey =
      x instanceof MilestoneAchievement
        ? x.enrollment
          ? programEnrollmentsTab.keyOf(x.enrollment)
          : ''
        : x.enrollment_key;
    const milestoneKey =
      x instanceof MilestoneAchievement
        ? x.milestone
          ? programMilestonesTab.keyOf(x.milestone)
          : ''
        : x.milestone_key;
    return `${enrollmentKey}|${milestoneKey}`;
  },

  diffFields(row: MilestoneAchievementRow, existing: MilestoneAchievement): string[] {
    const changed: string[] = [];
    if (row.achieved_on !== existing.achieved_on) changed.push('achieved_on');
    if (row.recorded_by !== existing.recorded_by) changed.push('recorded_by');
    if (row.score !== existing.score) changed.push('score');
    if (row.grade !== existing.grade) changed.push('grade');
    if (row.remark !== existing.remark) changed.push('remark');
    return changed;
  },

  async upsert(
    row: MilestoneAchievementRow,
    existing: MilestoneAchievement | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<MilestoneAchievement> {
    const achievement = existing ?? new MilestoneAchievement();
    achievement.tenant_id = tenantId;
    achievement.enrollment_id = row.enrollment_id;
    achievement.milestone_id = row.milestone_id;
    achievement.achieved_on = row.achieved_on;
    achievement.recorded_by = row.recorded_by;
    achievement.score = row.score;
    achievement.grade = row.grade;
    achievement.remark = row.remark;
    return m.save(MilestoneAchievement, achievement);
  },

  async remove(entity: MilestoneAchievement, m: EntityManager): Promise<void> {
    await m.remove(MilestoneAchievement, entity);
  },
};
