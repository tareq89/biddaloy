import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { SendCommunicationDto, CommunicationResponseDto } from './dto/communications.dto';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { COMMUNICATIONS_QUEUE } from './communications.constants';

function toResponseDto(log: CommunicationLog): CommunicationResponseDto {
  return {
    id: log.id,
    medium: log.medium,
    recipient_address: log.recipient_address,
    recipient_name: log.recipient_name,
    status: log.status,
    provider_message_id: log.provider_message_id,
    created_at: log.created_at,
  };
}

/**
 * Producer half of the communications module — validates the request,
 * writes the CommunicationLog row, and enqueues a job for
 * CommunicationsProcessor to actually dispatch. Kept deliberately free of
 * anything the consumer half needs, so the two can be split apart later
 * (see the plan's "Extraction recipe").
 */
@Injectable()
export class CommunicationsService {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly repo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
  ) {}

  async enqueue(
    dto: SendCommunicationDto,
    tenantId: string,
    userId: string,
  ): Promise<CommunicationResponseDto> {
    if (dto.student_id) {
      await this.studentService.findOne(dto.student_id, tenantId);
    }
    if (dto.guardian_id) {
      await this.guardianService.findOne(dto.guardian_id, tenantId);
    }

    const log = await this.repo.save(
      this.repo.create({
        tenant_id: tenantId,
        medium: dto.medium,
        recipient_address: dto.recipient_address,
        recipient_name: dto.recipient_name,
        message_body: dto.message_body,
        subject: dto.subject ?? null,
        student_id: dto.student_id ?? null,
        guardian_id: dto.guardian_id ?? null,
        sent_by_user_id: userId,
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.MANUAL,
        metadata: dto.template_name
          ? {
              template_name: dto.template_name,
              template_language: dto.template_language,
              template_params: dto.template_params,
            }
          : null,
      }),
    );

    try {
      await this.queue.add('send', { logId: log.id });
    } catch (err) {
      // The row would otherwise be stuck QUEUED forever with no job to
      // deliver it — surface the failure instead of a false "queued" success.
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await this.repo.save(log);
      throw new InternalServerErrorException('Failed to queue communication for delivery');
    }

    return toResponseDto(log);
  }

  async findOne(id: string, tenantId: string): Promise<CommunicationResponseDto> {
    const log = await this.repo.findOne({ where: { id, tenant_id: tenantId } });

    if (!log) {
      throw new NotFoundException(`Communication log with ID "${id}" not found`);
    }

    return toResponseDto(log);
  }

  /** [8.10.2]'s Communication tab — every message ever sent about this
   * student (single sends, and each recipient's row from a bulk reminder
   * batch), newest first. Plain array, no pagination — matches
   * `StudentService.findByStudent`/`PaymentService.findByStudent`'s own
   * by-student endpoints, since a single student's message history is
   * bounded in a way a tenant-wide list isn't. */
  async findByStudent(studentId: string, tenantId: string): Promise<CommunicationResponseDto[]> {
    const logs = await this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    return logs.map(toResponseDto);
  }

  /** [8.11.4]'s Communication History tab — every message ever sent to
   * this guardian directly, newest first. Mirrors `findByStudent` above;
   * `findOne` below throws `NotFoundException` if the guardian doesn't
   * belong to this tenant, so a cross-tenant guardian ID never leaks a
   * (necessarily empty) log list. */
  async findByGuardian(guardianId: string, tenantId: string): Promise<CommunicationResponseDto[]> {
    await this.guardianService.findOne(guardianId, tenantId);

    const logs = await this.repo.find({
      where: { guardian_id: guardianId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    return logs.map(toResponseDto);
  }

  /**
   * [8.10.4]'s dues queue "Last reminder" column — the most recent fee
   * reminder (bulk or single-send) per student, for an explicit set of
   * student IDs. Mirrors `FeeDuesService.getDueSnapshots`'s "batch keyed
   * by caller-supplied IDs" shape, for the same reason: a list page needs
   * one field per row without a request per row.
   *
   * Scoped to `BULK_REMINDER`/`SINGLE_REMINDER` triggers only — `MANUAL`
   * also covers unrelated freeform staff messages (`enqueue()` above), so
   * including it here would surface "you sent a message" as if it were a
   * fee reminder.
   */
  async findLastReminders(
    studentIds: string[],
    tenantId: string,
  ): Promise<Map<string, { sent_at: Date; medium: CommunicationMedium }>> {
    const byStudent = new Map<string, { sent_at: Date; medium: CommunicationMedium }>();
    if (studentIds.length === 0) return byStudent;

    const rows = await this.repo
      .createQueryBuilder('log')
      .distinctOn(['log.student_id'])
      .select('log.student_id', 'student_id')
      .addSelect('log.medium', 'medium')
      .addSelect('log.created_at', 'sent_at')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere('log.student_id IN (:...studentIds)', { studentIds })
      .andWhere('log.trigger IN (:...triggers)', {
        triggers: [CommunicationTrigger.BULK_REMINDER, CommunicationTrigger.SINGLE_REMINDER],
      })
      .orderBy('log.student_id', 'ASC')
      .addOrderBy('log.created_at', 'DESC')
      .getRawMany<{ student_id: string; medium: CommunicationMedium; sent_at: Date }>();

    for (const row of rows) {
      byStudent.set(row.student_id, { sent_at: row.sent_at, medium: row.medium });
    }

    return byStudent;
  }
}
