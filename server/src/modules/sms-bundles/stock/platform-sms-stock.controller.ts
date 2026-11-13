import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import {
  DeleteSmsStockDto,
  ListSmsStockQueryDto,
  ProviderBalanceDto,
  RecordProviderBalanceDto,
  RecordSmsStockDto,
  SmsStockEntryDto,
  SmsStockPageDto,
} from './dto/sms-stock.dto';
import { ProviderBalanceReader } from './provider-balance.reader';
import { SmsStockService, type Actor } from './sms-stock.service';

type CockpitReq = Request & { user: CockpitPrincipal; approval?: { approverId: string } };
const actor = (req: CockpitReq): Actor => ({
  userId: req.user.sub,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** [100.2.A1] The owner's SMS stock: what was bought, what the provider holds. Cockpit sessions only. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/sms-stock')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformSmsStockController {
  constructor(
    private readonly stock: SmsStockService,
    private readonly reader: ProviderBalanceReader,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'SMS purchases, newest first.' })
  list(@Query() q: ListSmsStockQueryDto): Promise<SmsStockPageDto> {
    return this.stock.list(q.limit, q.cursor);
  }

  @Post()
  @ApiOperation({ summary: 'Record an SMS purchase.' })
  record(@Body() dto: RecordSmsStockDto, @Req() req: CockpitReq): Promise<SmsStockEntryDto> {
    return this.stock.record(dto, actor(req));
  }

  @Get('balance')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The provider balance: live when the provider answers, else the last typed one.',
  })
  async balance(): Promise<ProviderBalanceDto> {
    const b = await this.reader.read();
    return {
      sms: b.sms,
      source: b.source,
      asOf: b.asOf ? b.asOf.toISOString() : null,
      stale: b.stale,
    };
  }

  @Post('balance')
  @ApiOperation({ summary: 'Type in the balance shown on the provider dashboard.' })
  recordBalance(@Body() dto: RecordProviderBalanceDto, @Req() req: CockpitReq) {
    return this.stock.recordBalance(dto.smsBalance, actor(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_SMS_STOCK)
  @ApiOperation({ summary: 'Delete a purchase record with a reason. Needs a step-up token.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteSmsStockDto,
    @Req() req: CockpitReq,
  ): Promise<void> {
    await this.stock.remove(id, dto.reason, {
      ...actor(req),
      approverId: req.approval?.approverId,
    });
  }
}
