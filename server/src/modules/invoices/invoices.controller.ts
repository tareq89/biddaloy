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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
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
  PrintFormatQueryDto,
} from './dto/invoices.dto';
import { Invoice } from './entities/invoice.entity';
import { paginatedSchema } from '../../common/swagger/paginated-schema.util';
import { UserRole, AuditAction, isGuardianRole, Permission } from '@biddaloy/shared';
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
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class InvoicesController {
  constructor(
    @Inject(InvoicesService) private readonly invoicesService: InvoicesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

  @Post()
  // [10.4] G1 — E tightened off: lacks INVOICE_CREATE.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.INVOICE_CREATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(AuditInterceptor)
  @Audited(AuditAction.INVOICE_GENERATED, 'Invoice')
  async create(
    @Body() dto: CreateInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    // [16.5.1] `create()` no longer takes a free-form DTO — it builds the
    // invoice from an already-recorded payment's committed allocations.
    // `createFromPayment` tenant-checks `dto.payment_id` and opens the
    // transaction `create()` itself no longer owns.
    const invoice = await this.invoicesService.createFromPayment(dto.payment_id, tenant.id);
    return toSafeInvoice(invoice);
  }

  @Get()
  // [10.4] G9 — E, T tightened off: `/invoices` nav is hidden from them,
  // and student-detail uses `payments/invoices/student/:id` instead.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.INVOICE_READ)
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
    // [H1 fix] Same multi-student privacy gap as `findOne` above: a row
    // matched by `student_id` can still carry other siblings' data in its
    // `snapshot.students[]`. Filter each row down to just the students the
    // caller is already known (via `linkedStudentIds` above) to be linked
    // to, so an unlinked sibling's name/registration number/fee lines
    // never leave the server through the list endpoint either.
    const linked = new Set(linkedStudentIds);
    return {
      ...page,
      data: page.data.map(toFamilyInvoice).map((familyInvoice) => ({
        ...familyInvoice,
        snapshot: {
          ...familyInvoice.snapshot,
          students: familyInvoice.snapshot.students.filter((s) => linked.has(s.id)),
        },
      })),
    };
  }

  @Get(':id')
  // [10.4] G9 — E, T tightened off; see findAll() above.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.INVOICE_READ)
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
    // [664 fix] A [16.5.1] invoice can cover more than one student — a
    // sibling/multi-student checkout groups every covered child's lines
    // into one `snapshot.students[]`. Checking only `invoice.student_id`
    // (the primary/first student) let a guardian linked to just one sibling
    // see every other sibling's name/registration number/fee lines through
    // this endpoint. `assertLinkedToAny` checks the caller against the
    // *whole* student set and returns which of them are actually linked;
    // the family response is then filtered down to that subset so an
    // unlinked sibling's data never leaves the server.
    const allStudentIds = [
      invoice.student_id,
      ...(invoice.snapshot?.students?.map((s) => s.id) ?? []),
    ];
    const linkedStudentIds = await this.familyAccess.assertLinkedToAny(
      tenant.role,
      user.sub,
      allStudentIds,
      tenant.id,
    );
    if (!isGuardianRole(tenant.role)) {
      return toSafeInvoice(invoice);
    }
    const linked = new Set(linkedStudentIds);
    const familyInvoice = toFamilyInvoice(invoice);
    return {
      ...familyInvoice,
      snapshot: {
        ...familyInvoice.snapshot,
        students: familyInvoice.snapshot.students.filter((s) => linked.has(s.id)),
      },
    };
  }

  @Get(':id/print')
  // [10.4] G11 — E, T removed (no INVOICE_READ); printing an invoice you may
  // read is a read, so this requires INVOICE_READ, not INVOICE_PRINT.
  // INVOICE_PRINT stays the UI's staff print-button gate.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.INVOICE_READ)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary:
      'Get a printable HTML rendering of the invoice, in a4 (default), pos58, or pos80 format. A PARENT or STUDENT must additionally be linked to its student, and only sees their own linked student(s) in the output.',
  })
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrintFormatQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Family callers only: resolve the invoice first so the linkage check
    // has a student to check against. `findOne` is tenant-scoped and 404s
    // before any family check runs, so an out-of-tenant id is never even
    // classified as "unlinked". Gated on the role because `assertLinked`
    // no-ops for staff, and `getPrintableHtml` re-fetches the invoice with
    // its own joins — staff should not pay for a check that cannot fail.
    let linkedStudentIds: string[] | undefined;
    if (isGuardianRole(tenant.role)) {
      const invoice = await this.invoicesService.findOne(id, tenant.id);
      // [664 fix] Same multi-student gap as `findOne` above — check the
      // caller against every student on the invoice, not just the primary
      // one.
      const allStudentIds = [
        invoice.student_id,
        ...(invoice.snapshot?.students?.map((s) => s.id) ?? []),
      ];
      // [665] The subset the caller is actually linked to — passed through
      // so `getPrintableHtml`/the templates filter `snapshot.students[]`
      // down to it, the same privacy boundary `findOne`'s JSON response
      // already enforces. A guardian linked to only one of two siblings on
      // a shared invoice must not see the other child's name/registration
      // number/fee lines in the printed HTML either.
      linkedStudentIds = await this.familyAccess.assertLinkedToAny(
        tenant.role,
        user.sub,
        allStudentIds,
        tenant.id,
      );
    }
    return this.invoicesService.getPrintableHtml(
      id,
      tenant.id,
      query.format ?? 'a4',
      linkedStudentIds,
    );
  }
}
