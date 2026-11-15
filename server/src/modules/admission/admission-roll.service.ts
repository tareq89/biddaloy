import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import { assertYearOpen } from '../../common/utils/year-open.guard';
import { startOfLocalDay, todayInSchoolTz } from '../../common/time';
import { AdmissionNotificationService } from './admission-notification.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionStage } from './entities/admission-stage.entity';
import type {
  AssignRollsResponseDto,
  RollOrder,
  StageScheduleDto,
  StageScheduleResponseDto,
} from './dto/roll.dto';

const ROLL_PAD = 4;
const ELIGIBLE = [AdmissionApplicantStatus.PENDING, AdmissionApplicantStatus.SHORTLISTED];

/** [71.G1.04, D21] Roll numbers for a round, and the date / time / venue of a stage. */
@Injectable()
export class AdmissionRollService {
  private readonly logger = new Logger(AdmissionRollService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: AdmissionNotificationService,
  ) {}

  /** Locks the round row; 404 when it is not this tenant's; a closed year refuses the write (Rule 28). */
  private async lockIntake(
    manager: EntityManager,
    intakeId: string,
    tenantId: string,
  ): Promise<AdmissionIntake> {
    const intake = await manager
      .getRepository(AdmissionIntake)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :intakeId AND i.tenant_id = :tenantId AND i.deleted_at IS NULL', {
        intakeId,
        tenantId,
      })
      .getOne();
    if (!intake) throw new NotFoundException('Admission intake not found');
    if (intake.academic_year_id) await assertYearOpen(manager, tenantId, intake.academic_year_id);
    return intake;
  }

  /**
   * Gives a roll to every fee-confirmed (PENDING / SHORTLISTED) applicant without one, in the chosen
   * order. Idempotent: a repeat call only numbers applicants who came in since. The intake row lock
   * serialises callers, so two parallel calls never share a number
   * (ponytail: no UNIQUE index on roll_number yet; add a partial one in a later migration).
   */
  async assign(
    intakeId: string,
    order: RollOrder,
    tenantId: string,
  ): Promise<AssignRollsResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const intake = await this.lockIntake(manager, intakeId, tenantId);
      const repo = manager.getRepository(AdmissionApplicant);
      const qb = repo
        .createQueryBuilder('a')
        .where('a.tenant_id = :tenantId AND a.intake_id = :intakeId', { tenantId, intakeId })
        .andWhere('a.deleted_at IS NULL AND a.roll_number IS NULL')
        .andWhere('a.status IN (:...eligible)', { eligible: ELIGIBLE });
      if (order === 'NAME') qb.orderBy('a.applicant_name', 'ASC');
      else qb.orderBy('a.created_at', 'ASC');
      const rows = await qb.addOrderBy('a.id', 'ASC').getMany();
      if (rows.length === 0) return { assigned: 0, first_roll: null, last_roll: null };

      const prefix = intake.roll_prefix ?? '';
      let counter = intake.roll_counter;
      const rolls = rows.map((row) => {
        counter += 1;
        const roll = `${prefix}${String(counter).padStart(ROLL_PAD, '0')}`;
        row.roll_number = roll;
        return roll;
      });
      await repo.save(rows);
      await manager
        .getRepository(AdmissionIntake)
        .update({ id: intake.id, tenant_id: tenantId }, { roll_counter: counter });
      return { assigned: rows.length, first_roll: rolls[0], last_roll: rolls[rolls.length - 1] };
    });
  }

  /** Stores date / start_time / venue in the stage `config` (other keys kept), then tells guardians if the round sends SMS. */
  async setSchedule(
    stageId: string,
    dto: StageScheduleDto,
    tenantId: string,
  ): Promise<StageScheduleResponseDto> {
    if (dto.date < todayInSchoolTz()) throw new BadRequestException('date cannot be in the past');
    const { intake, stage } = await this.dataSource.transaction(async (manager) => {
      const found = await manager.getRepository(AdmissionStage).findOne({
        where: { id: stageId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!found) throw new NotFoundException('Admission stage not found');
      const locked = await this.lockIntake(manager, found.intake_id, tenantId);
      const stage = await manager.getRepository(AdmissionStage).findOne({
        where: { id: stageId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!stage) throw new NotFoundException('Admission stage not found');
      stage.config = {
        ...stage.config,
        date: dto.date,
        start_time: dto.start_time,
        venue: dto.venue,
      };
      await manager.getRepository(AdmissionStage).save(stage);
      return { intake: locked, stage };
    });

    // After commit: a failed SMS must not undo the schedule.
    if (intake.publish_channels?.includes('SMS')) await this.notifyAll(intake, stage, dto);
    return { id: stage.id, date: dto.date, start_time: dto.start_time, venue: dto.venue };
  }

  private async notifyAll(
    intake: AdmissionIntake,
    stage: AdmissionStage,
    dto: StageScheduleDto,
  ): Promise<void> {
    const [h, m] = dto.start_time.split(':').map(Number);
    const at = new Date(startOfLocalDay(dto.date).getTime() + (h * 60 + m) * 60_000);
    const applicants = await this.dataSource.getRepository(AdmissionApplicant).find({
      where: {
        tenant_id: intake.tenant_id,
        intake_id: intake.id,
        status: In(ELIGIBLE),
        deleted_at: IsNull(),
      },
    });
    for (const applicant of applicants) {
      try {
        await this.notifications.notifyStageSchedule(
          applicant,
          intake.title,
          stage.title ?? stage.kind,
          at,
        );
      } catch (error) {
        this.logger.warn(
          `Stage schedule SMS failed for applicant ${applicant.id}: ${String(error)}`,
        );
      }
    }
  }
}
