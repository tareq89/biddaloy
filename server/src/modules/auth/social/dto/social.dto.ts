import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SocialProvider } from '@biddaloy/shared';

export class SocialProvidersDto {
  @ApiProperty({ enum: SocialProvider, isArray: true })
  providers: SocialProvider[];
}

export class SocialIdentityDto {
  @ApiProperty({ enum: SocialProvider })
  provider: SocialProvider;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty()
  created_at: Date;
}

export class SocialStartQueryDto {
  @IsIn(['login', 'register'])
  intent: 'login' | 'register';

  /** Same-origin path to land on after sign-in. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirect?: string;
}

export class SocialLinkStartDto {
  @ApiProperty({ description: 'Provider authorization URL to send the browser to.' })
  url: string;
}

export class SocialCallbackQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  code?: string;

  /** Optional so a callback without one lands on the failure page, not raw JSON. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  error?: string;
}

/** Meta posts this form body to the data-deletion callback. */
export class FacebookDataDeletionDto {
  @IsString()
  @MaxLength(4000)
  signed_request: string;
}

export class FacebookDataDeletionResponseDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  confirmation_code: string;
}

export class FacebookDataDeletionStatusQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  code: string;
}
