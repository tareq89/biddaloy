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
