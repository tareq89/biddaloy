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
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { InvoicesService } from './invoices.service';
import {
  CreateInvoiceDto,
  QueryInvoiceDto,
  toFamilyInvoice,
  FamilyInvoiceDto,
  StaffInvoiceDto,
} from './dto/invoices.dto';
import { Invoice } from './entities/invoice.entity';
import { paginatedSchema } from '../../common/swagger/paginated-schema.util';
import { UserRole, AuditAction, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { FamilyAccessService } from '../students/family-access.service';

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
// [5.1 review] `findAll` and `findOne` both return a role-dependent union,
// which the swagger plugin cannot infer — see the note on `FeeController`
// and `paginatedSchema`. `findAll` leaves `issued_by` unloaded, so its staff
// rows are plain `Invoice`; `findOne` runs them through `toSafeInvoice`,
// whose narrowed `issued_by` is modelled by `StaffInvoiceDto`.
@ApiExtraModels(Invoice, StaffInvoiceDto, FamilyInvoiceDto)
@Controller('invoices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class InvoicesController {
  constructor(
    @Inject(InvoicesService) private readonly invoicesService: InvoicesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

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
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary:
      "List invoices. Staff see the tenant's invoices; a PARENT or STUDENT sees only their linked students', even if `student_id` names someone else.",
  })
  @ApiOkResponse({
    description:
      'A page of invoices: `Invoice` rows for staff, allow-listed `FamilyInvoiceDto` rows for a PARENT/STUDENT.',
    schema: paginatedSchema([
      { $ref: getSchemaPath(Invoice) },
      { $ref: getSchemaPath(FamilyInvoiceDto) },
    ]),
  })
  async findAll(
    @Query() query: QueryInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isGuardianRole(tenant.role)) {
      return this.invoicesService.findAll(query, tenant.id);
    }
    const linkedStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.invoicesService.findAll(query, tenant.id, linkedStudentIds);
    return { ...page, data: page.data.map(toFamilyInvoice) };
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary:
      "Get one invoice. A PARENT or STUDENT must additionally be linked to the invoice's student.",
  })
  @ApiOkResponse({
    description:
      'A `StaffInvoiceDto` (the full invoice, with `issued_by` reduced to `UserResponseDto`) for staff; an allow-listed `FamilyInvoiceDto` for a PARENT/STUDENT.',
    schema: {
      oneOf: [{ $ref: getSchemaPath(StaffInvoiceDto) }, { $ref: getSchemaPath(FamilyInvoiceDto) }],
    },
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.invoicesService.findOne(id, tenant.id);
    await this.familyAccess.assertLinked(tenant.role, user.sub, invoice.student_id, tenant.id);
    return isGuardianRole(tenant.role) ? toFamilyInvoice(invoice) : toSafeInvoice(invoice);
  }

  @Get(':id/print')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary:
      'Get a printable HTML rendering of the invoice. A PARENT or STUDENT must additionally be linked to its student.',
  })
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Family callers only: resolve the invoice first so the linkage check
    // has a student to check against. `findOne` is tenant-scoped and 404s
    // before any family check runs, so an out-of-tenant id is never even
    // classified as "unlinked". Gated on the role because `assertLinked`
    // no-ops for staff, and `getPrintableHtml` re-fetches the invoice with
    // its own joins — staff should not pay for a check that cannot fail.
    if (isGuardianRole(tenant.role)) {
      const invoice = await this.invoicesService.findOne(id, tenant.id);
      await this.familyAccess.assertLinked(tenant.role, user.sub, invoice.student_id, tenant.id);
    }
    return this.invoicesService.getPrintableHtml(id, tenant.id);
  }
}
