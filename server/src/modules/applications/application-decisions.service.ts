import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ApplicationCaller } from './reviewer-scope';
import type { ApplicationDto } from './dto/application.dto';
import type {
  ApproveApplicationDto,
  BulkApproveDto,
  BulkApproveResultDto,
  CancelApplicationDto,
  ConsiderApplicationDto,
  RejectApplicationDto,
} from './dto/decide.dto';

/** [52.3.1] fills this. */
@Injectable()
export class ApplicationDecisionsService {
  async approve(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _dto: ApproveApplicationDto,
    _req: Request,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.3.1]');
  }

  async reject(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _dto: RejectApplicationDto,
    _req: Request,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.3.1]');
  }

  async consider(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _dto: ConsiderApplicationDto,
    _req: Request,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.3.1]');
  }

  async cancel(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _dto: CancelApplicationDto,
    _req: Request,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.3.1]');
  }

  async bulkApprove(
    _tenantId: string,
    _user: ApplicationCaller,
    _dto: BulkApproveDto,
    _req: Request,
  ): Promise<BulkApproveResultDto[]> {
    throw new NotImplementedException('[52.3.1]');
  }
}
