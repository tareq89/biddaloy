import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { HomeworkAssignmentStatus, HomeworkSubmissionStatus } from '@biddaloy/shared';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { HomeworkNoticeService } from './homework-notice.service';
import { SchoolsService } from '../schools/schools.service';
import { localToday } from '../attendance/attendance-policy.util';

export const HOMEWORK_DEFAULTER_SWEEP_QUEUE = 'homework-defaulter-sweep';
export const HOMEWORK_DEFAULTER_SWEEP_JOB_ID = 'homework-defaulter-sweep';
export const HOMEWORK_DEFAULTER_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

/** Yesterday's date (`YYYY-MM-DD`) in `timezone`, comparable against
 * `HomeworkAssignment.due_date` the same way `localToday` already is. */
function localYesterday(timezone: string): string {
  const today = new Date(`${localToday(timezone)}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().slice(0, 10);
}

/**
 * [22.3.3] Daily sweep: every `ACTIVE` `HomeworkAssignment` whose
 * `due_date` was yesterday, notify the guardians of every student whose
 * `HomeworkSubmission` is still `NOT_SUBMITTED`. Clones
 * `AbsenceNoticeScheduler`'s `OnModuleInit` + `upsertJobScheduler` +
 * per-tenant try/catch shape (one slow/broken tenant must not block the
 * rest of the sweep), but on a daily interval rather than 15 minutes since
 * `due_date` only changes once a day.
 */
@Injectable()
@Processor(HOMEWORK_DEFAULTER_SWEEP_QUEUE)
export class HomeworkDefaulterScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(HomeworkDefaulterScheduler.name);

  constructor(
    @InjectQueue(HOMEWORK_DEFAULTER_SWEEP_QUEUE) private readonly queue: Queue,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @InjectRepository(HomeworkSubmission)
    private readonly submissionRepo: Repository<HomeworkSubmission>,
    private readonly schoolsService: SchoolsService,
    private readonly homeworkNoticeService: HomeworkNoticeService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      HOMEWORK_DEFAULTER_SWEEP_JOB_ID,
      { every: HOMEWORK_DEFAULTER_SWEEP_INTERVAL_MS },
      {
        opts: {
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    this.logger.log(
      `Scheduled homework-defaulter sweep every ${HOMEWORK_DEFAULTER_SWEEP_INTERVAL_MS}ms`,
    );
  }

  async process(): Promise<void> {
    const tenants = await this.schoolsService.findAll();
    for (const tenant of tenants) {
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        this.logger.error(
          `Homework-defaulter sweep failed for tenant ${tenant.id}: ${String(error)}`,
        );
      }
    }
  }

  private async sweepTenant(tenantId: string): Promise<void> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const timezone = settings.region?.timezone ?? 'UTC';
    const dueDate = localYesterday(timezone);

    const assignments = await this.assignmentRepo.find({
      where: { tenant_id: tenantId, due_date: dueDate, status: HomeworkAssignmentStatus.ACTIVE },
      relations: ['homework'],
    });
    if (assignments.length === 0) return;

    for (const assignment of assignments) {
      try {
        const submissions = await this.submissionRepo.find({
          where: {
            tenant_id: tenantId,
            assignment_id: assignment.id,
            status: HomeworkSubmissionStatus.NOT_SUBMITTED,
          },
          relations: ['student', 'student.guardians'],
        });
        if (submissions.length === 0) continue;

        await this.homeworkNoticeService.notifyDefaulters(
          assignment,
          assignment.homework,
          submissions.map((s) => s.student),
        );
      } catch (error) {
        this.logger.error(
          `Homework-defaulter notice failed for assignment ${assignment.id} (tenant ${tenantId}): ${String(error)}`,
        );
      }
    }
  }
}
