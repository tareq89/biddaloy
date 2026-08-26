import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
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
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FeeStructureService, PaymentService } from './fees.service';
import { FeeGenerationService } from './fee-generation.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { FeeDuesService } from './fee-dues.service';
import { FamilyAccessService } from '../students/family-access.service';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  QueryFeeStructureDto,
  CreatePaymentDto,
  QueryPaymentDto,
  RecordPaymentWithAllocationDto,
  GenerateStudentFeesDto,
  GenerateFeesResultDto,
  QueryFeeDuesDto,
  QueryFlaggedDuesDto,
  toFamilyPayment,
  toFamilyStudentFee,
  toFamilyStudentDue,
  toFamilyFeeStructure,
  FamilyFeeStructureDto,
  FamilyPaymentDto,
  FamilyStudentDueDto,
  StaffStudentDueDto,
} from './dto/fees.dto';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { UserRole, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { paginatedSchema } from '../../common/swagger/paginated-schema.util';

// [5.1 review] Several routes below return a *role-dependent union* — the
// staff shape for staff, an allow-listed family DTO for a PARENT/STUDENT.
// Nest's swagger plugin infers response schemas from a method's return type
// and cannot express a union, so those routes generated as an untyped body
// (`Record<string, never>` in the client's `schema.d.ts`) or, worse, as the
// family-only shape that staff callers never receive. Each such route
// declares its contract explicitly with `@ApiOkResponse` + `oneOf`, following
// the `@ApiExtraModels`/`getSchemaPath` precedent in `EnrollmentController`.
@ApiTags('fees')
@ApiTenantAuth()
@ApiExtraModels(
  FeeStructure,
  FamilyFeeStructureDto,
  Payment,
  FamilyPaymentDto,
  StaffStudentDueDto,
  FamilyStudentDueDto,
)
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class FeeController {
  constructor(
    @Inject(FeeStructureService) private readonly feeStructureService: FeeStructureService,
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(FeeGenerationService) private readonly feeGenerationService: FeeGenerationService,
    @Inject(PaymentAllocationService)
    private readonly paymentAllocationService: PaymentAllocationService,
    @Inject(FeeDuesService) private readonly feeDuesService: FeeDuesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

  // --- Fee Dues endpoints ---

  @Get('fees/dues')
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
      "List outstanding dues. Staff see the whole tenant (subject to the query filters); a PARENT or STUDENT sees only their linked students' dues, whatever filters they send.",
  })
  @ApiOkResponse({
    description:
      'A page of per-student due summaries: `StaffStudentDueDto` rows for staff, `FamilyStudentDueDto` rows (no `reminder_threshold_date`) for a PARENT/STUDENT.',
    schema: paginatedSchema([
      { $ref: getSchemaPath(StaffStudentDueDto) },
      { $ref: getSchemaPath(FamilyStudentDueDto) },
    ]),
  })
  async getDues(
    @Query() query: QueryFeeDuesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Family callers are narrowed to their linked students *before* the
    // query runs — `class_id`/`section_id` in the query string can only
    // narrow that set further, never widen it. `getFlaggedDues` below stays
    // staff-only: it returns guardian contact details for follow-up.
    if (!isGuardianRole(tenant.role)) {
      return this.feeDuesService.getDues(query, tenant.id);
    }
    const restrictToStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.feeDuesService.getDues(query, tenant.id, restrictToStudentIds);
    // Each `dues[]` row is a `DueEntry`, which carries the internal
    // `reminder_threshold_date`. Shaped through the same allow-list DTO the
    // rest of the family surface uses.
    return { ...page, data: page.data.map(toFamilyStudentDue) };
  }

  @Get('fees/dues/flagged')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: 'List dues flagged for follow-up (e.g. overdue past a threshold).' })
  getFlaggedDues(
    @Query() query: QueryFlaggedDuesDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeDuesService.getFlaggedDues(query, tenant.id);
  }

  // --- Fee Generation endpoint ---

  @Post('fees/generate')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Generate StudentFee rows for the matching fee structures over a given month/scope.',
  })
  generateFees(
    @Body() dto: GenerateStudentFeesDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<GenerateFeesResultDto> {
    return this.feeGenerationService.generate(dto, tenant.id);
  }

  // --- Fee Structure endpoints ---

  @Post('fee-structures')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createFeeStructure(
    @Body() dto: CreateFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.create(dto, tenant.id);
  }

  @Get('fee-structures')
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
      "The school's fee catalog. Tenant-scoped but not student-scoped — it is the published price list, so no object-level check applies. [5.1] opened it to PARENT/STUDENT so the portal can explain what a due is for.",
  })
  @ApiOkResponse({
    description:
      'A page of fee structures: full `FeeStructure` rows for staff, reduced `FamilyFeeStructureDto` rows for a PARENT/STUDENT.',
    schema: paginatedSchema([
      { $ref: getSchemaPath(FeeStructure) },
      { $ref: getSchemaPath(FamilyFeeStructureDto) },
    ]),
  })
  async findAllFeeStructures(
    @Query() query: QueryFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const page = await this.feeStructureService.findAll(query, tenant.id);
    if (!isGuardianRole(tenant.role)) {
      return page;
    }
    return { ...page, data: page.data.map(toFamilyFeeStructure) };
  }

  @Get('fee-structures/:id')
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
      "Get one fee structure. Family callers get a reduced shape without the `selected_students` roster — that relation carries other families' children in full.",
  })
  @ApiOkResponse({
    description:
      'The full `FeeStructure` for staff; a `FamilyFeeStructureDto` without `selected_students` for a PARENT/STUDENT.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(FeeStructure) },
        { $ref: getSchemaPath(FamilyFeeStructureDto) },
      ],
    },
  })
  async findOneFeeStructure(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const structure = await this.feeStructureService.findOne(id, tenant.id);
    // `findOne` eager-loads `selected_students.student` for the staff edit
    // dialog's student picker. Returning it raw to a PARENT/STUDENT would
    // expose unrelated children's full_name, date_of_birth, gender,
    // home_address, registration_number and user_id.
    return isGuardianRole(tenant.role) ? toFamilyFeeStructure(structure) : structure;
  }

  @Patch('fee-structures/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  updateFeeStructure(
    @Param('id') id: string,
    @Body() dto: UpdateFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.feeStructureService.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete('fee-structures/:id')
  @Roles(UserRole.ADMIN)
  removeFeeStructure(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.remove(id, tenant.id);
  }

  // --- Payment endpoints ---

  @Post('payments')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.create(dto, tenant.id, user.sub);
  }

  @Post('payments/record-with-allocation')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({
    summary:
      "Record a payment and allocate it across the student's outstanding fees in FIFO order, generating an invoice when a fee is paid in full.",
  })
  recordPaymentWithAllocation(
    @Body() dto: RecordPaymentWithAllocationDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentAllocationService.recordWithAllocation(dto, tenant.id, user.sub);
  }

  @Get('payments')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @ApiOperation({ summary: 'Search payments (receipts) by transaction reference or student name.' })
  findAll(@Query() query: QueryPaymentDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.paymentService.findAll(query, tenant.id);
  }

  @Get('payments/student/:studentId')
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
      "A student's payment history. A PARENT or STUDENT must additionally be linked to this student, and gets a reduced payment shape without staff-only fields.",
  })
  @ApiOkResponse({
    description:
      'Raw `Payment` rows for staff; reduced `FamilyPaymentDto` rows for a PARENT/STUDENT.',
    schema: {
      type: 'array',
      items: {
        oneOf: [{ $ref: getSchemaPath(Payment) }, { $ref: getSchemaPath(FamilyPaymentDto) }],
      },
    },
  })
  async findPaymentsByStudent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const payments = await this.paymentService.findByStudent(studentId, tenant.id);
    return isGuardianRole(tenant.role) ? payments.map(toFamilyPayment) : payments;
  }

  @Get('payments/guardian/:guardianId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: "Get every payment recorded for a guardian's linked students." })
  findPaymentsByGuardian(
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.paymentService.findByGuardian(guardianId, tenant.id);
  }

  @Get('payments/invoices/student/:studentId')
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
      "Get a student's fee/payment/balance summary. A PARENT or STUDENT must additionally be linked to this student.",
  })
  async getInvoiceSummary(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const summary = await this.paymentService.getInvoiceSummary(studentId, tenant.id);
    if (!isGuardianRole(tenant.role)) {
      return summary;
    }
    return {
      ...summary,
      // Allow-listed via FamilyStudentFeeDto — see its docstring for what
      // is withheld and why.
      fee_breakdown: summary.fee_breakdown.map(toFamilyStudentFee),
      payments: summary.payments.map(toFamilyPayment),
    };
  }
}
