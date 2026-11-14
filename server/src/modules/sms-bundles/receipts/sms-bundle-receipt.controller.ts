import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { ReceiptService } from '../../billing/receipt.service';

@ApiTags('sms-bundles')
@ApiTenantAuth()
@Controller('sms-bundles')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SmsBundleReceiptController {
  constructor(private readonly receipts: ReceiptService) {}

  /** The numbered receipt of a paid SMS order of this school (A4 HTML; the browser saves it as PDF). */
  @Get('orders/:id/receipt')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Download the receipt of a paid SMS package order.' })
  @ApiOkResponse({ description: 'Receipt HTML' })
  receipt(
    @CurrentTenant() tenant: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string> {
    return this.receipts.renderBundleForSchool(tenant.id, id);
  }
}
