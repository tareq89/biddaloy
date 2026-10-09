import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { Homework } from './entities/homework.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import {
  addressForMedium,
  DISPATCHABLE_MEDIA,
  resolveReminderAudience,
} from '../communications/reminder-recipients.util';

/**
 * [22.3.3] Guardian notices for homework assignment + non-submission,
 * cloning `AbsenceNoticeService`'s `CommunicationLog` construction and
 * opt-out/medium resolution (`reminder-recipients.util.ts`) verbatim.
 * Unlike absence notices, there is no `ReminderBatch` here — the ticket's
 * `## Files`/`## Steps` never mention one, and `CommunicationLog.reminder_batch_id`
 * is nullable for exactly this "one-off automated send" case.
 */
@Injectable()
export class HomeworkNoticeService {
  private readonly logger = new Logger(HomeworkNoticeService.name);

  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
  ) {}

  /** Called synchronously right after `HomeworkService.assign()` saves the
   * new assignment — one notice per guardian of every targeted student. */
  async notifyAssignment(assignment: HomeworkAssignment, homework: Homework): Promise<void> {
    const students = await this.loadTargetStudents(assignment);
    const message = `Dear Guardian, new homework "${homework.title}" has been assigned, due ${assignment.due_date}.`;
    await this.sendToGuardians(assignment.tenant_id, students, message);
  }

  /** Called by `HomeworkDefaulterScheduler`'s daily sweep — one notice per
   * guardian of every still-`NOT_SUBMITTED` student past `due_date`. */
  async notifyDefaulters(
    assignment: HomeworkAssignment,
    homework: Homework,
    defaulters: Student[],
  ): Promise<void> {
    const message = `Dear Guardian, homework "${homework.title}" (due ${assignment.due_date}) has not been submitted yet.`;
    await this.sendToGuardians(assignment.tenant_id, defaulters, message);
  }

  private async loadTargetStudents(assignment: HomeworkAssignment): Promise<Student[]> {
    if (assignment.student_id) {
      const student = await this.studentRepo.findOne({
        where: { id: assignment.student_id, tenant_id: assignment.tenant_id },
        relations: ['guardians'],
      });
      return student ? [student] : [];
    }
    return this.studentRepo.find({
      where: { class_section_id: assignment.section_id as string, tenant_id: assignment.tenant_id },
      relations: ['guardians'],
    });
  }

  /** Same skip/opt-out rules as `AbsenceNoticeService.resolveAbsentees`, but
   * flattened rather than grouped — a guardian already notified for one
   * student in this same call is not messaged again for a second one. */
  private async sendToGuardians(
    tenantId: string,
    students: Student[],
    message: string,
  ): Promise<void> {
    const notifiedGuardianIds = new Set<string>();

    for (const student of students) {
      const linked = student.guardians ?? [];
      if (linked.length === 0) continue;

      const { guardians } = resolveReminderAudience(linked);
      for (const guardian of guardians) {
        if (notifiedGuardianIds.has(guardian.id)) continue;

        const medium = guardian.preferred_communication;
        if (!DISPATCHABLE_MEDIA.includes(medium)) continue;
        const address = addressForMedium(guardian, medium);
        if (!address) continue;

        notifiedGuardianIds.add(guardian.id);

        let log: CommunicationLog;
        try {
          log = await this.logRepo.save(
            this.logRepo.create({
              tenant_id: tenantId,
              medium,
              recipient_address: address,
              recipient_name: guardian.full_name,
              message_body: message,
              subject: 'Homework Notice',
              student_id: student.id,
              guardian_id: guardian.id,
              sent_by_user_id: null,
              status: CommunicationStatus.QUEUED,
              trigger: CommunicationTrigger.AUTOMATED,
            }),
          );
        } catch (error) {
          // Same "don't let one bad insert kill the rest of the sweep" as
          // AbsenceNoticeService.queueRecipients — no batch counter to
          // update here since there is no ReminderBatch.
          this.logger.warn(
            `Failed to create CommunicationLog for guardian ${guardian.id}: ${String(error)}`,
          );
          continue;
        }

        try {
          await this.queue.add('send', { logId: log.id });
        } catch (error) {
          this.logger.warn(`Failed to enqueue homework-notice log ${log.id}: ${String(error)}`);
          log.status = CommunicationStatus.FAILED;
          log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
          await this.logRepo.save(log);
        }
      }
    }
  }
}
