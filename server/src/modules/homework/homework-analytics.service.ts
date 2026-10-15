import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
  TeacherAssignmentType,
} from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { addDays, localToday } from '../attendance/attendance-policy.util';
import { teacherAssignments } from '../classes/teacher-scope.service';
import { HomeworkSubmissionRateDto, MySyllabusProgressDto } from './dto/homework-dashboard.dto';

/**
 * A "complete" submission — anything past NOT_SUBMITTED (D13). A defaulter
 * is a submission still NOT_SUBMITTED whose assignment's `due_date` has
 * passed, mirroring `HomeworkDefaulterScheduler`'s own definition.
 */
const COMPLETE_STATUSES: readonly HomeworkSubmissionStatus[] = [
  HomeworkSubmissionStatus.SUBMITTED,
  HomeworkSubmissionStatus.PARTIAL,
  HomeworkSubmissionStatus.DONE,
];

export interface CompletionRollup {
  totalAssignments: number;
  completed: number;
  defaulters: number;
  completionPercent: number;
}

export interface SyllabusRollup {
  totalTopics: number;
  done: number;
  completionPercent: number;
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  // Floor, not round — a completion rate should never read as higher than
  // reality (2/3 done reads as 66%, not a rounded-up 67%).
  return Math.floor((numerator / denominator) * 100);
}

/**
 * [22.3.6] Read-only rollups over homework completion/defaulters (D13) and
 * class-level syllabus completion (D29). No mutation, no tenant-write path —
 * every query is scoped by `tenant_id` on the submission/assignment rows
 * themselves, the same isolation boundary every other service in this
 * module uses.
 */
@Injectable()
export class HomeworkAnalyticsService {
  constructor(
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @InjectRepository(HomeworkSubmission)
    private readonly submissionRepo: Repository<HomeworkSubmission>,
    @InjectRepository(SyllabusTopic)
    private readonly syllabusRepo: Repository<SyllabusTopic>,
  ) {}

  private rollupFromSubmissions(
    submissions: readonly HomeworkSubmission[],
    dueDateByAssignmentId: Map<string, string>,
    today: string,
  ): CompletionRollup {
    let completed = 0;
    let defaulters = 0;
    for (const submission of submissions) {
      if (COMPLETE_STATUSES.includes(submission.status)) {
        completed += 1;
      } else if ((dueDateByAssignmentId.get(submission.assignment_id) ?? '') < today) {
        defaulters += 1;
      }
    }
    return {
      totalAssignments: submissions.length,
      completed,
      defaulters,
      completionPercent: percent(completed, submissions.length),
    };
  }

  /** All of one student's submissions, across every homework assigned to
   * them directly or through a section they belong to. */
  async getStudentRollup(
    studentId: string,
    tenantId: string,
    timezone = 'UTC',
  ): Promise<CompletionRollup> {
    const submissions = await this.submissionRepo.find({
      where: { tenant_id: tenantId, student_id: studentId },
      relations: ['assignment'],
    });
    const dueDateByAssignmentId = new Map(
      submissions.map((s) => [s.assignment_id, s.assignment.due_date]),
    );
    return this.rollupFromSubmissions(submissions, dueDateByAssignmentId, localToday(timezone));
  }

  /** All submissions against assignments targeting one section directly
   * (D24 — a section-wide assignment, not a per-student one). */
  async getSectionRollup(
    sectionId: string,
    tenantId: string,
    timezone = 'UTC',
  ): Promise<CompletionRollup> {
    const assignments = await this.assignmentRepo.find({
      where: { tenant_id: tenantId, section_id: sectionId },
    });
    if (assignments.length === 0) {
      return { totalAssignments: 0, completed: 0, defaulters: 0, completionPercent: 0 };
    }
    const dueDateByAssignmentId = new Map(assignments.map((a) => [a.id, a.due_date]));
    const submissions = await this.submissionRepo.find({
      where: { tenant_id: tenantId, assignment_id: In(assignments.map((a) => a.id)) },
    });
    return this.rollupFromSubmissions(submissions, dueDateByAssignmentId, localToday(timezone));
  }

  /** Completion + defaulter rollup across every assignment for a class
   * (via that class's homework), plus a syllabus-completion % (D29).
   * `sectionIds` (a teacher's sections, Epic 75 D35) keeps only assignments to those sections
   * or to a student who sits in one. */
  async getClassRollup(
    classId: string,
    tenantId: string,
    timezone = 'UTC',
    sectionIds?: string[],
  ): Promise<CompletionRollup & { syllabus: SyllabusRollup }> {
    const base = { tenant_id: tenantId, homework: { class_id: classId } };
    const assignments = await this.assignmentRepo.find({
      where: sectionIds
        ? [
            { ...base, section_id: In(sectionIds) },
            { ...base, student: { class_section_id: In(sectionIds) } },
          ]
        : base,
      relations: ['homework'],
    });
    const dueDateByAssignmentId = new Map(assignments.map((a) => [a.id, a.due_date]));
    const submissions =
      assignments.length === 0
        ? []
        : await this.submissionRepo.find({
            where: { tenant_id: tenantId, assignment_id: In(assignments.map((a) => a.id)) },
          });
    const rollup = this.rollupFromSubmissions(
      submissions,
      dueDateByAssignmentId,
      localToday(timezone),
    );

    const topics = await this.syllabusRepo.find({
      where: { tenant_id: tenantId, class_id: classId },
    });
    const done = topics.filter((t) => t.status === SyllabusTopicStatus.DONE).length;
    return {
      ...rollup,
      syllabus: {
        totalTopics: topics.length,
        done,
        completionPercent: percent(done, topics.length),
      },
    };
  }

  /**
   * [8.10.7.3.19] ADMIN card: submitted vs assigned for homework due in the last 7 days
   * (today and the 6 days before), per class of the current year. "Submitted" = COMPLETE_STATUSES,
   * so it agrees with `getClassRollup`.
   */
  async getSubmissionRateByClass(tenantId: string): Promise<HomeworkSubmissionRateDto> {
    const to = localToday();
    const from = addDays(to, -6);
    const rows: { class_id: string; class_name: string; assigned: string; submitted: string }[] =
      await this.assignmentRepo.manager.query(
        `SELECT c.id AS class_id, c.name AS class_name, COUNT(*) AS assigned,
                COUNT(*) FILTER (WHERE hs.status::text = ANY($4::text[])) AS submitted
           FROM homework_submissions hs
           JOIN homework_assignments ha ON ha.id = hs.assignment_id AND ha.tenant_id = $1
           JOIN homework h ON h.id = ha.homework_id AND h.tenant_id = $1
           JOIN classes c ON c.id = h.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
           JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
             AND ay.is_current = true AND ay.deleted_at IS NULL
          WHERE hs.tenant_id = $1 AND ha.status = 'ACTIVE' AND ha.due_date BETWEEN $2 AND $3
          GROUP BY c.id, c.name, c.numeric_grade
          ORDER BY c.numeric_grade ASC NULLS LAST, c.name ASC, c.id ASC`,
        [tenantId, from, to, COMPLETE_STATUSES],
      );
    const classes = rows.map((r) => {
      const assigned = Number(r.assigned);
      const submitted = Number(r.submitted);
      return {
        class_id: r.class_id,
        class_name: r.class_name,
        assigned,
        submitted,
        percentage: percent(submitted, assigned),
      };
    });
    const assigned = classes.reduce((n, c) => n + c.assigned, 0);
    const submitted = classes.reduce((n, c) => n + c.submitted, 0);
    return {
      window: { from, to },
      overall: { assigned, submitted, percentage: percent(submitted, assigned) },
      classes,
    };
  }

  /**
   * [8.10.7.3.19] Teacher card: done % per (class, subject) the caller teaches as SUBJECT_TEACHER
   * in the current year. Topics are per class + subject, so every section shares one %.
   * Lowest % first.
   */
  async getTeacherSyllabusProgress(
    tenantId: string,
    userId: string,
  ): Promise<MySyllabusProgressDto> {
    const manager = this.syllabusRepo.manager;
    const mine = (await teacherAssignments(manager, { userId, tenantId })).filter(
      (r) => r.assignment_type === TeacherAssignmentType.SUBJECT_TEACHER && r.subject_id,
    );
    if (mine.length === 0) return { items: [] };
    const pairs = [...new Set(mine.map((r) => `${r.class_id}:${r.subject_id}`))].map((k) =>
      k.split(':'),
    );
    const rows: {
      class_id: string;
      class_name: string;
      subject_id: string;
      subject_name_en: string;
      subject_name_bn: string | null;
      done: string;
      total: string;
    }[] = await manager.query(
      `SELECT c.id AS class_id, c.name AS class_name, sub.id AS subject_id,
              sub.name_en AS subject_name_en, sub.name_bn AS subject_name_bn,
              COUNT(st.id) AS total, COUNT(st.id) FILTER (WHERE st.status = 'DONE') AS done
         FROM unnest($2::uuid[], $3::uuid[]) AS p(class_id, subject_id)
         JOIN classes c ON c.id = p.class_id AND c.tenant_id = $1
         JOIN subjects sub ON sub.id = p.subject_id AND sub.tenant_id = $1
         LEFT JOIN syllabus_topics st ON st.class_id = p.class_id AND st.subject_id = p.subject_id
           AND st.tenant_id = $1
        GROUP BY c.id, c.name, sub.id, sub.name_en, sub.name_bn`,
      [tenantId, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    );
    const sectionRows: { id: string; section_name: string }[] = await manager.query(
      `SELECT id, section_name FROM class_sections WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, mine.map((r) => r.section_id)],
    );
    const nameOf = new Map(sectionRows.map((s) => [s.id, s.section_name]));
    const items = rows.map((r) => {
      const done = Number(r.done);
      const total = Number(r.total);
      const sectionIds = [
        ...new Set(
          mine
            .filter((m) => m.class_id === r.class_id && m.subject_id === r.subject_id)
            .map((m) => m.section_id),
        ),
      ].sort((a, b) => (nameOf.get(a) ?? '').localeCompare(nameOf.get(b) ?? ''));
      return {
        class_id: r.class_id,
        class_name: r.class_name,
        sections: sectionIds.map((id) => ({ section_id: id, section_name: nameOf.get(id) ?? '' })),
        subject_id: r.subject_id,
        subject_name_en: r.subject_name_en,
        subject_name_bn: r.subject_name_bn,
        done,
        total,
        percentage: percent(done, total),
      };
    });
    return {
      items: items.sort(
        (a, b) =>
          a.percentage - b.percentage ||
          a.class_name.localeCompare(b.class_name) ||
          a.subject_name_en.localeCompare(b.subject_name_en),
      ),
    };
  }
}
