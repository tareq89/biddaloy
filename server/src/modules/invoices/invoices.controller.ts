import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
  Header,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, QueryInvoiceDto } from './dto/invoices.dto';
import { UserRole, AuditAction } from '@beton-boi/shared';
import { JwtPayload } from '@beton-boi/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';

// findOne (and create, which returns findOne's result) load the issued_by
// User relation in full — strip its password_hash before it reaches a
// response. The explicit `issued_by: UserResponseDto | null` return type
// matters, not just the runtime value: Swagger's schema generation reads
// the method's type, and a generic passthrough that stayed structurally
// typed as `T` (with `T.issued_by: User | null`) would let the full User
// entity — password_hash included — leak into the generated OpenAPI
// document as an orphaned schema even though no response returns it.
function toSafeInvoice<T extends { issued_by: User | null }>(
  invoice: T,
): Omit<T, 'issued_by'> & { issued_by: UserResponseDto | null } {
  return {
    ...invoice,
    issued_by: invoice.issued_by ? UserResponseDto.fromEntity(invoice.issued_by) : null,
  };
}

@ApiTags('invoices')
@ApiTenantAuth()
@Controller('invoices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class InvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoicesService: InvoicesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(AuditInterceptor)
  @Audited(AuditAction.INVOICE_GENERATED, 'Invoice')
  async create(
    @Body() dto: CreateInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.invoicesService.create(dto, tenant.id, user.sub);
    return toSafeInvoice(invoice);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAll(@Query() query: QueryInvoiceDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.invoicesService.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const invoice = await this.invoicesService.findOne(id, tenant.id);
    return toSafeInvoice(invoice);
  }

  @Get(':id/print')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Get a printable HTML rendering of the invoice.' })
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.invoicesService.getPrintableHtml(id, tenant.id);
  }
}
