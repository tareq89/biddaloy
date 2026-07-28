import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query, UseGuards, Header, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, QueryInvoiceDto } from './dto/invoices.dto';
import { UserRole } from '@beton-boi/shared';
import { JwtPayload } from '@beton-boi/shared';

@Controller('invoices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class InvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoicesService: InvoicesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoicesService.create(dto, tenant.id, user.sub);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAll(@Query() query: QueryInvoiceDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.invoicesService.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.invoicesService.findOne(id, tenant.id);
  }

  @Get(':id/print')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @Header('Content-Type', 'text/html; charset=utf-8')
  print(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.invoicesService.getPrintableHtml(id, tenant.id);
  }
}
