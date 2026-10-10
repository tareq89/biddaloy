import { Injectable, NotImplementedException } from '@nestjs/common';
import type { ApplicationCaller } from './reviewer-scope';
import type { ApplicationAttachmentDto } from './dto/application.dto';

/** [52.2.3] fills this. */
@Injectable()
export class ApplicationAttachmentsService {
  async upload(
    _tenantId: string,
    _user: ApplicationCaller,
    _applicationId: string,
    _files: Express.Multer.File[],
  ): Promise<ApplicationAttachmentDto[]> {
    throw new NotImplementedException('[52.2.3]');
  }

  async open(
    _tenantId: string,
    _user: ApplicationCaller,
    _applicationId: string,
    _attachmentId: string,
  ): Promise<unknown> {
    throw new NotImplementedException('[52.2.3]');
  }

  async remove(
    _tenantId: string,
    _user: ApplicationCaller,
    _applicationId: string,
    _attachmentId: string,
  ): Promise<void> {
    throw new NotImplementedException('[52.2.3]');
  }
}
