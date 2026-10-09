import type { Type } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { ApplicationType } from '@biddaloy/shared';
import type { Application } from './entities/application.entity';
import { StaffLeaveHandler } from './handlers/staff-leave.handler';
import { StudentLeaveHandler } from './handlers/student-leave.handler';
import { FeeWaiverHandler } from './handlers/fee-waiver.handler';
import { ReadmissionHandler } from './handlers/readmission.handler';
import { SectionChangeHandler } from './handlers/section-change.handler';
import { TransferCertificateHandler } from './handlers/transfer-certificate.handler';
import { ManualHandler } from './handlers/manual.handler';
import { StaffLeavePayloadDto } from './dto/payloads/staff-leave.dto';
import { StudentLeavePayloadDto } from './dto/payloads/student-leave.dto';
import { FeeWaiverPayloadDto } from './dto/payloads/fee-waiver.dto';
import { TestimonialPayloadDto } from './dto/payloads/testimonial.dto';
import { TransferCertificatePayloadDto } from './dto/payloads/transfer-certificate.dto';
import { ReadmissionPayloadDto } from './dto/payloads/readmission.dto';
import { SectionChangePayloadDto } from './dto/payloads/section-change.dto';
import { ScriptRecheckPayloadDto } from './dto/payloads/script-recheck.dto';
import { IdCardReprintPayloadDto } from './dto/payloads/id-card-reprint.dto';
import { GeneralPayloadDto } from './dto/payloads/general.dto';

export interface ApplicationEffectContext {
  tenantId: string;
  actorUserId: string;
  granted?: Record<string, unknown>; // D39
  /** Express request: handlers call requestContext(req); FEE_WAIVER reads X-Approval-Token from it. */
  req: Request;
  /** Cancel reason (D41), passed to cancel(). */
  reason?: string;
}

/** Structural, not a class hierarchy (D42). */
export type EffectHandler = {
  apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null>;
  cancel?(manager: EntityManager, app: Application, ctx: ApplicationEffectContext): Promise<void>;
};

export const APPLICATION_HANDLERS: Record<ApplicationType, Type<EffectHandler> | null> = {
  [ApplicationType.STAFF_LEAVE]: StaffLeaveHandler,
  [ApplicationType.STUDENT_LEAVE]: StudentLeaveHandler,
  [ApplicationType.FEE_WAIVER]: FeeWaiverHandler,
  [ApplicationType.READMISSION]: ReadmissionHandler,
  [ApplicationType.SECTION_CHANGE]: SectionChangeHandler,
  [ApplicationType.TRANSFER_CERTIFICATE]: TransferCertificateHandler,
  [ApplicationType.TESTIMONIAL]: ManualHandler,
  [ApplicationType.ID_CARD_REPRINT]: ManualHandler,
  [ApplicationType.SCRIPT_RECHECK]: ManualHandler,
  [ApplicationType.GENERAL]: null, // D11: no effect
};

/** The class-validator class that validates each type's `payload` (D3: forms fixed in code). */
export const APPLICATION_PAYLOAD_DTOS: Record<ApplicationType, Type<object>> = {
  [ApplicationType.STAFF_LEAVE]: StaffLeavePayloadDto,
  [ApplicationType.STUDENT_LEAVE]: StudentLeavePayloadDto,
  [ApplicationType.FEE_WAIVER]: FeeWaiverPayloadDto,
  [ApplicationType.TESTIMONIAL]: TestimonialPayloadDto,
  [ApplicationType.TRANSFER_CERTIFICATE]: TransferCertificatePayloadDto,
  [ApplicationType.READMISSION]: ReadmissionPayloadDto,
  [ApplicationType.SECTION_CHANGE]: SectionChangePayloadDto,
  [ApplicationType.SCRIPT_RECHECK]: ScriptRecheckPayloadDto,
  [ApplicationType.ID_CARD_REPRINT]: IdCardReprintPayloadDto,
  [ApplicationType.GENERAL]: GeneralPayloadDto,
};
