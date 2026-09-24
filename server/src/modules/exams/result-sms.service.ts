import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository, IsNull, In } from 'typeorm';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ExamStatus,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../communications/credits/insufficient-sms-credit.constants';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

export interface ResultSmsOutcome {
  queued: number;
  skipped: Array<{ student_id: string; reason: string }>;
}

/**
 * [19.5.1] Sends each guardian their child's published result by SMS,
 * reusing the communications module's own send path (`CommunicationLog`
 * + `COMMUNICATIONS_QUEUE`) and credit ledger (`SmsCreditService.reserve`,
 * same as `reminders.service.ts`'s bulk flow) — no second sender, no new
 * queue, no new worker.
 */
@Injectable()
export class ResultSmsService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly smsCreditService: SmsCreditService,
    private readonly auditService: AuditService,
  ) {}

  async sendForExam(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ResultSmsOutcome> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new BadRequestException(`Exam with ID "${examId}" not found`);
    }
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException(`Exam "${examId}" is not published — nothing to send yet.`);
    }

    const results = await this.resultRepo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const students =
      results.length === 0
        ? []
        : await this.studentRepo.find({
            where: { id: In(results.map((r) => r.student_id)), tenant_id: tenantId },
            relations: ['guardians'],
          });
    const studentById = new Map(students.map((s) => [s.id, s]));

    const skipped: ResultSmsOutcome['skipped'] = [];
    const jobs: Array<{ log: CommunicationLog }> = [];

    for (const result of results) {
      const student = studentById.get(result.student_id);
      if (!student) {
        skipped.push({ student_id: result.student_id, reason: 'student_not_found' });
        continue;
      }
      const guardians = (student.guardians ?? []).filter((g) => g.phone && g.notifications_enabled);
      if (guardians.length === 0) {
        skipped.push({ student_id: student.id, reason: 'no_reachable_guardian' });
        continue;
      }

      const body = `${student.full_name}'s result for "${exam.name}": GPA ${result.gpa}, Grade ${result.grade}${result.is_fail ? ' (FAIL)' : ''}.`;
      for (const guardian of guardians) {
        // One log per guardian per student — the same "one message per
        // recipient" shape reminders.service.ts uses, not one per exam.
        jobs.push({
          log: this.logRepo.create({
            tenant_id: tenantId,
            medium: CommunicationMedium.SMS,
            recipient_address: guardian.phone as string,
            recipient_name: guardian.full_name,
            message_body: body,
            student_id: student.id,
            guardian_id: guardian.id,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.RESULT_SMS,
          }),
        });
      }
    }

    if (jobs.length === 0) {
      return { queued: 0, skipped };
    }

    const metered = await this.smsCreditService.isMetered(tenantId);
    if (metered) {
      const reservation = await this.smsCreditService.reserve(
        tenantId,
        jobs.length,
        `exam-result-sms:${examId}`,
        { type: 'manual', id: examId },
      );
      if (!reservation.ok) {
        throw new ConflictException({
          message: "Insufficient SMS credit to send this exam's result SMS.",
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: jobs.length,
            available: reservation.available,
          },
        });
      }
    }

    let queued = 0;
    for (const job of jobs) {
      const saved = await this.logRepo.save(job.log);
      try {
        await this.queue.add('send', { logId: saved.id });
        queued += 1;
      } catch {
        saved.status = CommunicationStatus.FAILED;
        saved.metadata = { ...saved.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.save(saved);
      }
    }

    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'Exam',
      entity_id: examId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { queued, skipped_count: skipped.length },
    });

    return { queued, skipped };
  }
}
