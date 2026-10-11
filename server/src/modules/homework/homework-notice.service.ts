import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationStatus, CommunicationTrigger, EnrollmentStatus } from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { Homework } from './entities/homework.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  CREDIT_RESERVE_FAILED,
  INSUFFICIENT_SMS_CREDIT,
} from '../communications/credits/insufficient-sms-credit.constants';
import {
  addressForMedium,
  DISPATCHABLE_MEDIA,
  resolveReminderAudience,
} from '../communications/reminder-recipients.util';
import { resolveFeeNotificationLocale } from '../communications/fee-notification-template.util';
import { SchoolsService } from '../schools/schools.service';

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
    private readonly smsCreditService: SmsCreditService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** Called synchronously right after `HomeworkService.assign()` saves the
   * new assignment — one notice per guardian of every targeted student. */
  async notifyAssignment(assignment: HomeworkAssignment, homework: Homework): Promise<void> {
    // [TIME-11] Off unless the school turned it on.
    const settings = await this.schoolsService.getResolvedSettings(assignment.tenant_id);
    if (settings.homework?.notifyOnAssign !== true) return;
    const students = await this.loadTargetStudents(assignment);
    const due = assignment.due_date;
    // [JOBS-09] The title stays as the teacher typed it.
    const bn = resolveFeeNotificationLocale(settings.region?.locale) === 'bn';
    await this.sendToGuardians(assignment.tenant_id, students, (names) =>
      bn
        ? `প্রিয় অভিভাবক, ${names}-এর জন্য নতুন বাড়ির কাজ "${homework.title}" দেওয়া হয়েছে, জমার শেষ তারিখ ${due}।`
        : `Dear Guardian, new homework "${homework.title}" has been assigned to ${names}, due ${due}.`,
    );
  }

  /** Called by `HomeworkDefaulterScheduler`'s daily sweep — one notice per
   * guardian of every still-`NOT_SUBMITTED` student past `due_date`. */
  async notifyDefaulters(
    assignment: HomeworkAssignment,
    homework: Homework,
    defaulters: Student[],
  ): Promise<void> {
    const settings = await this.schoolsService.getResolvedSettings(assignment.tenant_id);
    if (settings.homework?.notifyDefaulters !== true) return;
    const due = assignment.due_date;
    const bn = resolveFeeNotificationLocale(settings.region?.locale) === 'bn';
    await this.sendToGuardians(assignment.tenant_id, defaulters, (names) =>
      bn
        ? `প্রিয় অভিভাবক, ${names}-এর বাড়ির কাজ "${homework.title}" (শেষ তারিখ ${due}) এখনও জমা হয়নি।`
        : `Dear Guardian, homework "${homework.title}" (due ${due}) has not been submitted yet by ${names}.`,
    );
  }

  private async loadTargetStudents(assignment: HomeworkAssignment): Promise<Student[]> {
    if (assignment.student_id) {
      const student = await this.studentRepo.findOne({
        where: {
          id: assignment.student_id,
          tenant_id: assignment.tenant_id,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
        relations: ['guardians'],
      });
      return student ? [student] : [];
    }
    return this.studentRepo.find({
      where: {
        class_section_id: assignment.section_id as string,
        tenant_id: assignment.tenant_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: ['guardians'],
    });
  }

  /** Same skip/opt-out rules as `AbsenceNoticeService.resolveAbsentees`:
   * grouped per guardian so a guardian of two students gets ONE message that
   * names both. */
  private async sendToGuardians(
    tenantId: string,
    students: Student[],
    buildMessage: (studentNames: string) => string,
  ): Promise<void> {
    const byGuardian = new Map<string, { guardian: Guardian; students: Student[] }>();
    for (const student of students) {
      const linked = student.guardians ?? [];
      if (linked.length === 0) continue;
      const { guardians } = resolveReminderAudience(linked);
      for (const guardian of guardians) {
        const medium = guardian.preferred_communication;
        if (!DISPATCHABLE_MEDIA.includes(medium)) continue;
        if (!addressForMedium(guardian, medium)) continue;
        const entry = byGuardian.get(guardian.id);
        if (entry) entry.students.push(student);
        else byGuardian.set(guardian.id, { guardian, students: [student] });
      }
    }

    for (const { guardian, students: kids } of byGuardian.values()) {
      const student = kids[0];
      const medium = guardian.preferred_communication;
      const address = addressForMedium(guardian, medium) as string;
      const message = buildMessage(kids.map((k) => k.full_name).join(', '));
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

      // [#2216] Metered SMS must hold credit before it is queued. A reserve
      // that throws fails this log only — never strand it QUEUED or skip
      // the remaining guardians.
      const credit = await this.smsCreditService
        .reserveForLog(tenantId, log)
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to reserve SMS credit for homework-notice log ${log.id}: ${String(error)}`,
          );
          return CREDIT_RESERVE_FAILED;
        });
      if (typeof credit === 'string') {
        log.status = CommunicationStatus.FAILED;
        log.metadata = {
          ...log.metadata,
          reason: credit === 'INSUFFICIENT' ? INSUFFICIENT_SMS_CREDIT : credit,
        };
        await this.logRepo.save(log);
        continue;
      }

      try {
        await this.queue.add('send', { logId: log.id, ...credit });
      } catch (error) {
        if (credit.segments !== undefined) {
          await this.smsCreditService.releaseForLog(tenantId, log.id, credit.segments);
        }
        this.logger.warn(`Failed to enqueue homework-notice log ${log.id}: ${String(error)}`);
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.save(log);
      }
    }
  }
}
