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
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
} from './dto/fees.dto';
import { UserRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';

@ApiTags('fees')
@ApiTenantAuth()
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
  ) {}

  // --- Fee Dues endpoints ---

  @Get('fees/dues')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  getDues(@Query() query: QueryFeeDuesDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.feeDuesService.getDues(query, tenant.id);
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
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllFeeStructures(
    @Query() query: QueryFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.findAll(query, tenant.id);
  }

  @Get('fee-structures/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOneFeeStructure(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.findOne(id, tenant.id);
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
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findPaymentsByStudent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.paymentService.findByStudent(studentId, tenant.id);
  }

  @Get('payments/invoices/student/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: "Get a student's fee/payment/balance summary." })
  getInvoiceSummary(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.paymentService.getInvoiceSummary(studentId, tenant.id);
  }
}
