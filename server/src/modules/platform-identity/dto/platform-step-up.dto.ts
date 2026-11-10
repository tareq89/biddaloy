import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ApprovalScope } from '@biddaloy/shared';

/** Body of `POST /platform/step-up`: a fresh authenticator code for one platform scope. */
export class PlatformStepUpDto {
  @ApiProperty({ enum: ApprovalScope })
  @IsEnum(ApprovalScope)
  scope: ApprovalScope;

  @ApiProperty({ description: 'Current 6-digit authenticator code. Recovery codes are refused.' })
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  code: string;
}

export interface PlatformStepUpResponse {
  approval_token: string;
  expires_at: string;
}
