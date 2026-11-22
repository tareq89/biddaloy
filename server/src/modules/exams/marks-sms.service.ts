import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  EnrollmentStatus,
  MarkGridState,
  MarkStatus,
  ReminderBatchStatus,
  countSmsSegments,
} from '@biddaloy/shared';
import { MarkGrid } from './entities/mark-grid.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Exam } from './entities/exam.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { School } from '../schools/entities/school.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { resolveReminderAudience } from '../communications/reminder-recipients.util';
import { recordBatchOutcome } from '../communications/reminder-batch-counters';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../communications/credits/insufficient-sms-credit.constants';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import {
  resolveTemplateLocale,
  type TemplateLocale,
} from '../account-access/account-access-templates';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { computeSubjectTotal } from './result-rules';

export interface MarksSmsSkipped {
  student_id: string;
  reason: 'no_reachable_guardian' | 'notifications_off' | 'no_marks';
}

export interface MarksSmsPreview {
  /** Messages (one per student x guardian) that a send would queue now. */
  count: number;
  /** SMS segments (= credits) those messages cost. */
  segments: number;
  skipped: MarksSmsSkipped[];
  /** Set only when every pair was already sent: when the earlier send happened. */
  already_sent_at: Date | null;
}

export interface MarksSmsOutcome {
  queued: number;
  segments: number;
  skipped: MarksSmsSkipped[];
  already_sent_at: Date | null;
}

const PG_UNIQUE_VIOLATION = '23505';

/** Fixed sentence, no exam or grid id (Rules 23/24). */
const NOT_SUBMITTED = 'This marks list is not submitted — nothing to send yet.';

const trim = (n: number) => String(Number(n.toFixed(2)));

/**
 * `<Name> — <Exam>, <Subject>: 18/25`. Absent and failed subjects say so in words; the grade is
 * appended only when the caller has one.
 */
export function buildMarksBody(args: {
  locale: TemplateLocale;
  name: string;
  exam: string;
  subject: string;
  total: { obtained: number; full_marks: number; is_absent: boolean; component_failed: boolean };
  grade?: string | null;
}): string {
  const { locale, name, exam, subject, total, grade } = args;
  const bn = locale === 'bn';
  let value: string;
  if (total.is_absent) {
    value = bn ? 'অনুপস্থিত' : 'absent';
  } else {
    value = `${trim(total.obtained)}/${trim(total.full_marks)}`;
    if (total.component_failed) value += bn ? ' (ফেল)' : ' (fail)';
    if (grade) value += bn ? `, গ্রেড ${grade}` : `, grade ${grade}`;
  }
  return `${name} — ${exam}, ${subject}: ${value}`;
}

interface Planned {
  log: CommunicationLog;
  segments: number;
}

/**
 * [80.3.x] Previews and sends one SMS per reachable guardian with a student's marks in one
 * SUBMITTED exam x section x subject grid. Same `CommunicationLog` + `COMMUNICATIONS_QUEUE` +
 * `SmsCreditService.reserve` path as `ResultSmsService`; the batch header follows
 * `RemindersService.sendBulk` (reserve `batch:<ReminderBatch.id>`, compensating delete).
 * Teacher scope is the controller's job; this takes an already-authorised grid id.
 */
@Injectable()
export class MarksSmsService {
  private readonly logger = new Logger(MarksSmsService.name);

  constructor(
    @InjectRepository(MarkGrid)
    private readonly gridRepo: Repository<MarkGrid>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly smsCreditService: SmsCreditService,
    private readonly auditService: AuditService,
  ) {}

  /** The URL carries exam/section/subject; the grid is the unique triple (tenant-scoped). */
  async resolveGridId(
    examId: string,
    sectionId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<string> {
    const grid = await this.gridRepo.findOne({
      where: { exam_id: examId, section_id: sectionId, subject_id: subjectId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!grid) throw new NotFoundException('Marks list not found');
    return grid.id;
  }

  async preview(gridId: string, tenantId: string): Promise<MarksSmsPreview> {
    const { jobs, skipped, alreadySentAt } = await this.plan(gridId, tenantId, '');
    return {
      count: jobs.length,
      segments: jobs.reduce((s, j) => s + j.segments, 0),
      skipped,
      already_sent_at: alreadySentAt,
    };
  }

  async send(
    gridId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<MarksSmsOutcome> {
    const { jobs, skipped, alreadySentAt, exam, subject } = await this.plan(
      gridId,
      tenantId,
      userId,
    );
    // Fully-sent (or nothing reachable): no batch, no reserve.
    if (jobs.length === 0) {
      return { queued: 0, segments: 0, skipped, already_sent_at: alreadySentAt };
    }
    const totalSegments = jobs.reduce((s, j) => s + j.segments, 0);

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name: `Marks SMS — ${exam}, ${subject}`.slice(0, 200),
        status: ReminderBatchStatus.PROCESSING,
        total_recipients: jobs.length,
        message_template: null,
        initiated_by_user_id: userId,
        // D31: the kind lives in the JSON (no kind column).
        filters_applied: { kind: 'MARKS_SMS', mark_grid_id: gridId, skipped },
      }),
    );

    // Reserve BEFORE any log/job exists. A refused or failed reserve deletes the header (D34).
    const metered = await this.smsCreditService.isMetered(tenantId);
    if (metered) {
      let reservation: { ok: true } | { ok: false; available: number };
      try {
        reservation = await this.smsCreditService.reserve(
          tenantId,
          totalSegments,
          `batch:${batch.id}`,
          { type: 'batch', id: batch.id },
        );
      } catch (err) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw err;
      }
      if (!reservation.ok) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw new ConflictException({
          message: 'Insufficient SMS credit to send these marks.',
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: totalSegments,
            available: reservation.available,
          },
        });
      }
    }

    // A worker-FAILED row keeps its reference_key and would trip the unique index on retry;
    // plan() already treats it as retryable, so free the key here.
    await this.logRepo.update(
      {
        tenant_id: tenantId,
        reference_key: In(jobs.map((j) => j.log.reference_key!)),
        status: CommunicationStatus.FAILED,
      },
      { reference_key: null },
    );

    let queued = 0;
    let queuedSegments = 0;
    for (const job of jobs) {
      job.log.reminder_batch_id = batch.id;
      let saved: CommunicationLog | undefined;
      try {
        saved = await this.logRepo.save(job.log);
        await this.queue.add('send', {
          logId: saved.id,
          // Segments only when a reserve really happened (the worker's settlePart throws otherwise).
          ...(metered ? { batchId: batch.id, segments: job.segments } : {}),
        });
        queued += 1;
        queuedSegments += job.segments;
      } catch (err) {
        await this.failEnqueue(err, job, saved, batch.id, tenantId, metered);
      }
    }

    // The messages are already queued: a failed audit write must not turn a sent batch into a 500
    // (the page would tell the teacher it failed and they would send again).
    try {
      await this.auditService.record({
        action: AuditAction.REMINDER_SENT,
        entity_type: 'ReminderBatch',
        entity_id: batch.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { queued, skipped_count: skipped.length },
      });
    } catch (err) {
      this.logger.error({
        msg: 'marks-sms audit record failed after the batch was queued',
        tenant_id: tenantId,
        batch_id: batch.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { queued, segments: queuedSegments, skipped, already_sent_at: null };
  }

  /** Same recovery as `ResultSmsService.dispatch`, plus the batch counter so it cannot stick at PROCESSING. */
  private async failEnqueue(
    err: unknown,
    job: Planned,
    saved: CommunicationLog | undefined,
    batchId: string,
    tenantId: string,
    metered: boolean,
  ): Promise<void> {
    if ((err as { code?: string } | null)?.code !== PG_UNIQUE_VIOLATION) {
      this.logger.error({
        msg: 'marks-sms enqueue failed',
        tenant_id: tenantId,
        communication_log_id: saved?.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (metered) {
      try {
        await this.smsCreditService.settlePart(
          tenantId,
          `batch:${batchId}`,
          saved ? `log:${saved.id}` : `enqueue-failed:${randomUUID()}`,
          job.segments,
          'RELEASE',
        );
      } catch (releaseErr) {
        this.logger.error({
          msg: 'sms credit release on enqueue failure failed — reservation left stranded',
          communication_log_id: saved?.id,
          tenant_id: tenantId,
          error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
    }
    try {
      if (saved) {
        saved.status = CommunicationStatus.FAILED;
        // Nothing queued: release the dedupe key so a retry can send this pair.
        saved.metadata = {
          ...saved.metadata,
          error: 'Failed to enqueue for delivery',
          released_reference_key: saved.reference_key,
        };
        saved.reference_key = null;
        await this.logRepo.manager.transaction(async (m) => {
          await m.save(saved);
          await recordBatchOutcome(m, batchId, 'failure');
        });
      } else {
        await recordBatchOutcome(this.logRepo.manager, batchId, 'failure');
      }
    } catch (saveErr) {
      this.logger.error({
        msg: 'failed to record marks-sms enqueue failure',
        tenant_id: tenantId,
        error: saveErr instanceof Error ? saveErr.message : String(saveErr),
      });
    }
  }

  /** Everything a send decides, without writing: preview and send share it so they agree. */
  private async plan(gridId: string, tenantId: string, userId: string) {
    const grid = await this.gridRepo.findOne({ where: { id: gridId, tenant_id: tenantId } });
    if (!grid) throw new NotFoundException('Marks list not found');
    if (grid.state !== MarkGridState.SUBMITTED) throw new ConflictException(NOT_SUBMITTED);

    const m = this.gridRepo.manager;
    const [examRow, subjectRow, school, components, students] = await Promise.all([
      m.findOne(Exam, { where: { id: grid.exam_id, tenant_id: tenantId } }),
      m.findOne(Subject, { where: { id: grid.subject_id, tenant_id: tenantId } }),
      m.findOne(School, { where: { id: tenantId }, select: { id: true, settings: true } }),
      m.find(ExamComponent, {
        where: {
          exam_id: grid.exam_id,
          subject_id: grid.subject_id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      }),
      m.find(Student, {
        where: {
          class_section_id: grid.section_id,
          tenant_id: tenantId,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: IsNull(),
        },
        relations: ['guardians'],
      }),
    ]);
    const locale = resolveTemplateLocale(school?.settings?.region?.locale);
    const examName = examRow?.name ?? '';
    const subjectName = (locale === 'bn' ? subjectRow?.name_bn : null) ?? subjectRow?.name_en ?? '';

    const studentIds = students.map((s) => s.id);
    const [marks, results] =
      studentIds.length === 0
        ? [[] as Mark[], [] as Result[]]
        : await Promise.all([
            m.find(Mark, {
              where: {
                exam_id: grid.exam_id,
                subject_id: grid.subject_id,
                tenant_id: tenantId,
                student_id: In(studentIds),
              },
            }),
            m.find(Result, {
              where: {
                exam_id: grid.exam_id,
                tenant_id: tenantId,
                student_id: In(studentIds),
                deleted_at: IsNull(),
              },
            }),
          ]);
    // D23: a grade only when the result pipeline has produced a result_subjects row.
    const resultSubjects =
      results.length === 0
        ? []
        : await m.find(ResultSubject, {
            where: {
              result_id: In(results.map((r) => r.id)),
              subject_id: grid.subject_id,
              tenant_id: tenantId,
              deleted_at: IsNull(),
            },
          });
    const studentByResult = new Map(results.map((r) => [r.id, r.student_id]));
    const gradeByStudent = new Map(
      resultSubjects.map((rs) => [studentByResult.get(rs.result_id)!, rs.grade]),
    );
    const compById = new Map(components.map((c) => [c.id, c]));

    const skipped: MarksSmsSkipped[] = [];
    const planned: Planned[] = [];
    for (const student of students) {
      const own = marks.filter((x) => x.student_id === student.id && compById.has(x.component_id));
      const total = computeSubjectTotal(
        own.map((x) => {
          const c = compById.get(x.component_id)!;
          return {
            full_marks: Number(c.full_marks),
            pass_marks: c.pass_marks == null ? null : Number(c.pass_marks),
            value: x.value == null ? null : Number(x.value),
            status: x.status,
          };
        }),
      );
      const hasNumber = total.is_absent || total.full_marks > 0;
      if (own.length === 0 || !hasNumber || own.every((x) => x.status === MarkStatus.EXEMPT)) {
        skipped.push({ student_id: student.id, reason: 'no_marks' });
        continue;
      }
      const linked = (student.guardians ?? []).filter((g) => g.phone);
      const audience = resolveReminderAudience(linked);
      if (audience.guardians.length === 0) {
        skipped.push({
          student_id: student.id,
          reason: audience.skippedOptOut.length > 0 ? 'notifications_off' : 'no_reachable_guardian',
        });
        continue;
      }
      const body = buildMarksBody({
        locale,
        name: locale === 'bn' ? (student.full_name_bn ?? student.full_name) : student.full_name,
        exam: examName,
        subject: subjectName,
        total,
        grade: gradeByStudent.get(student.id),
      });
      const segments = countSmsSegments(body).segments;
      for (const g of audience.guardians) {
        planned.push({
          segments,
          log: this.logRepo.create({
            tenant_id: tenantId,
            medium: CommunicationMedium.SMS,
            recipient_address: g.phone as string,
            recipient_name: g.full_name,
            message_body: body,
            student_id: student.id,
            guardian_id: g.id,
            sent_by_user_id: userId || null,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.MARKS_SMS,
            // D30
            reference_key: `marks-sms:${gridId}:${student.id}:${g.id}`,
          }),
        });
      }
    }

    // Existing keys looked up BEFORE any reserve, so a fully-sent grid reserves nothing (D10).
    let jobs = planned;
    let alreadySentAt: Date | null = null;
    if (planned.length > 0) {
      const existing = await this.logRepo.find({
        where: {
          tenant_id: tenantId,
          reference_key: In(planned.map((j) => j.log.reference_key!)),
          // A FAILED row never reached the guardian; it must not block a retry.
          status: Not(CommunicationStatus.FAILED),
        },
        select: ['reference_key', 'created_at'],
      });
      const sent = new Set(existing.map((e) => e.reference_key));
      jobs = planned.filter((j) => !sent.has(j.log.reference_key));
      if (jobs.length === 0 && existing.length > 0) {
        alreadySentAt = new Date(Math.min(...existing.map((e) => e.created_at.getTime())));
      }
    }
    return { jobs, skipped, alreadySentAt, exam: examName, subject: subjectName };
  }
}
