import { Injectable, NotImplementedException } from '@nestjs/common';
import type { ApplicationCaller } from './reviewer-scope';
import type { ApplicationReportsDto, PendingCountDto, ReportsQueryDto } from './dto/reports.dto';

/** [52.3.5] fills this. */
@Injectable()
export class ApplicationReportsService {
  async pendingCount(_tenantId: string, _user: ApplicationCaller): Promise<PendingCountDto> {
    throw new NotImplementedException('[52.3.5]');
  }

  async reports(
    _tenantId: string,
    _user: ApplicationCaller,
    _query: ReportsQueryDto,
  ): Promise<ApplicationReportsDto> {
    throw new NotImplementedException('[52.3.5]');
  }
}
