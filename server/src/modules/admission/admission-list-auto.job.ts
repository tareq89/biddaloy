import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { ModuleKey } from '@biddaloy/shared';
import { ModuleStateReader } from '../auth/guards/module-state.reader';
import { isModuleOnForSchool } from '../schools/settings/school-modules.util';
import { SchoolsService } from '../schools/schools.service';
import { AdmissionListService } from './admission-list.service';
import { AdmissionStageService } from './admission-stage.service';
import type { ResultActor } from './admission-stage-result.service';

export const ADMISSION_LIST_AUTO_QUEUE = 'admission-list-auto';
export const ADMISSION_LIST_AUTO_JOB_ID = 'admission-list-auto';
export const ADMISSION_LIST_AUTO_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Audit rows of the job carry no user (`performed_by_user_id` is nullable; the list service only writes it to audit). */
const SYSTEM_ACTOR = {
  userId: null,
  ip: null,
  userAgent: 'admission-list-auto',
} as unknown as ResultActor;

/**
 * [71.2.10, Epic 71 D24] For rounds with `auto_activate_lists = true` (default false): expire the
 * lapsed offers, then open the next list if seats remain. One failing round never blocks the rest.
 * A repeat is harmless: expiring is a no-op the second time and `activate` answers 409 for a list
 * that is already open or whose previous deadline has not passed (swallowed here).
 */
@Injectable()
@Processor(ADMISSION_LIST_AUTO_QUEUE)
export class AdmissionListAutoJob extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AdmissionListAutoJob.name);

  constructor(
    @InjectQueue(ADMISSION_LIST_AUTO_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
    private readonly lists: AdmissionListService,
    private readonly stageService: AdmissionStageService,
    private readonly moduleState: ModuleStateReader,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ADMISSION_LIST_AUTO_JOB_ID,
      { every: ADMISSION_LIST_AUTO_INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    const rounds: { id: string; tenant_id: string }[] = await this.dataSource.query(
      `SELECT id, tenant_id FROM admission_intakes
        WHERE auto_activate_lists = true AND deleted_at IS NULL`,
    );
    for (const r of rounds) {
      try {
        await this.runRound(r.id, r.tenant_id);
      } catch (error) {
        this.logger.error(`List auto-activation failed for round ${r.id}: ${String(error)}`);
      }
    }
  }

  /** Public for the spec. */
  async runRound(intakeId: string, tenantId: string): Promise<void> {
    if (!(await isModuleOnForSchool(this.moduleState, tenantId, ModuleKey.admission))) return;
    const today = await this.schools.todayFor(tenantId);

    await this.dataSource.transaction(async (manager) => {
      await this.stageService.lockIntake(manager, intakeId, tenantId);
      await this.lists.expireLapsedForIntake(manager, intakeId, tenantId, SYSTEM_ACTOR, today);
    });

    const [next]: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM admission_lists
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL AND activated_at IS NULL
        ORDER BY (kind <> 'MERIT'), sequence LIMIT 1`,
      [tenantId, intakeId],
    );
    if (!next) return;
    try {
      await this.lists.activate(next.id, tenantId, SYSTEM_ACTOR);
    } catch (error) {
      // 409 = not yet due, already open or no seats: nothing to do this run.
      if (error instanceof HttpException && error.getStatus() === 409) return;
      throw error;
    }
  }
}
