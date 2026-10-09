import { Injectable, NotImplementedException } from '@nestjs/common';
import type { RequestContext } from '../../common/request-context.util';
import type { ApplicationCaller } from './reviewer-scope';
import type {
  AddresseeOptionDto,
  ApplicationDto,
  ApplicationEventDto,
  ApplicationListDto,
  ApplicationTagInput,
  CreateApplicationDto,
  LetterPreviewDto,
  LetterPreviewResultDto,
  TagOptionsDto,
} from './dto/application.dto';
import type { QueryApplicationsDto } from './dto/query-applications.dto';

/** [52.2.1] fills this. */
@Injectable()
export class ApplicationsService {
  async submit(
    _tenantId: string,
    _user: ApplicationCaller,
    _dto: CreateApplicationDto,
    _ctx: RequestContext,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async list(
    _tenantId: string,
    _user: ApplicationCaller,
    _query: QueryApplicationsDto,
  ): Promise<ApplicationListDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async get(_tenantId: string, _user: ApplicationCaller, _id: string): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async withdraw(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _ctx: RequestContext,
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async comment(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _note: string,
  ): Promise<ApplicationEventDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async addTags(
    _tenantId: string,
    _user: ApplicationCaller,
    _id: string,
    _tags: ApplicationTagInput[],
  ): Promise<ApplicationDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async addressees(
    _tenantId: string,
    _user: ApplicationCaller,
    _studentId?: string,
  ): Promise<AddresseeOptionDto[]> {
    throw new NotImplementedException('[52.2.1]');
  }

  async tagOptions(_tenantId: string, _q: string): Promise<TagOptionsDto> {
    throw new NotImplementedException('[52.2.1]');
  }

  async letterPreview(
    _tenantId: string,
    _user: ApplicationCaller,
    _dto: LetterPreviewDto,
  ): Promise<LetterPreviewResultDto> {
    throw new NotImplementedException('[52.2.1]');
  }
}
