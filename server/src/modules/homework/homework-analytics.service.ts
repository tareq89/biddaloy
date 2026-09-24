import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HomeworkSubmissionStatus, SyllabusTopicStatus } from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { localToday } from '../attendance/attendance-policy.util';

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
   * (via that class's homework), plus a syllabus-completion % (D29). */
  async getClassRollup(
    classId: string,
    tenantId: string,
    timezone = 'UTC',
  ): Promise<CompletionRollup & { syllabus: SyllabusRollup }> {
    const assignments = await this.assignmentRepo.find({
      where: { tenant_id: tenantId, homework: { class_id: classId } },
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
}
