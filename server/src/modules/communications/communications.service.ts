import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { SendCommunicationDto, CommunicationResponseDto } from './dto/communications.dto';
import { CommunicationStatus, CommunicationTrigger } from '@beton-boi/shared';
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

  async enqueue(dto: SendCommunicationDto, tenantId: string, userId: string): Promise<CommunicationResponseDto> {
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
          ? { template_name: dto.template_name, template_language: dto.template_language, template_params: dto.template_params }
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
}
