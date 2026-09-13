import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApprovalScope } from '@biddaloy/shared';

/**
 * Body of `POST /auth/step-up/otp/request` — enumeration-safe: the response
 * is always 202 whether or not `identifier` resolves to an approver.
 */
export class StepUpOtpRequestDto {
  @ApiProperty({ description: "The approver's email or phone." })
  @IsString()
  @MaxLength(255)
  identifier: string;
}

/** `method` accepted by `POST /auth/step-up`. */
export type StepUpMethod = 'OTP' | 'PASSWORD';

/**
 * Body of `POST /auth/step-up` — verifies the approver by OTP or password
 * and, on success, issues a short-lived approval token scoped to one
 * gated action (`ApprovalScope`).
 */
export class StepUpVerifyDto {
  @ApiProperty({ description: "The approver's email or phone." })
  @IsString()
  @MaxLength(255)
  identifier: string;

  @ApiProperty({ enum: ['OTP', 'PASSWORD'] })
  @IsIn(['OTP', 'PASSWORD'])
  method: StepUpMethod;

  @ApiProperty({ required: false, description: '6-digit OTP — required when method is OTP.' })
  @ValidateIf((dto: StepUpVerifyDto) => dto.method === 'OTP')
  @IsString()
  @MaxLength(10)
  otp?: string;

  @ApiProperty({
    required: false,
    description: "The approver's password — required when method is PASSWORD.",
  })
  @ValidateIf((dto: StepUpVerifyDto) => dto.method === 'PASSWORD')
  @IsString()
  @MaxLength(255)
  password?: string;

  @ApiProperty({ enum: ApprovalScope })
  @IsEnum(ApprovalScope)
  scope: ApprovalScope;
}

/** Response of `POST /auth/step-up`. */
export interface StepUpApprovalResponse {
  approval_token: string;
  expires_at: string;
  approver: { id: string; full_name: string };
}
