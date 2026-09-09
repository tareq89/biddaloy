import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

/** The `keys` object inside a browser `PushSubscription.toJSON()` payload. */
export class PushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  auth: string;
}

/**
 * `POST /me/push/subscriptions` body — the browser's
 * `PushSubscription.toJSON()` shape, verbatim. `expirationTime` is accepted
 * (some push services set it) but not persisted — nothing in this module
 * currently acts on it.
 */
export class CreatePushSubscriptionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  endpoint: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  expirationTime?: number | null;
}

/** `GET /me/push/public-key` response. */
export class PushPublicKeyResponseDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ nullable: true })
  public_key: string | null;
}

/**
 * One row of `GET /me/push/subscriptions`. Deliberately omits `endpoint`/
 * `keys` — those are secrets (the endpoint is a capability URL, `auth`/
 * `p256dh` are the subscription's auth secret and public key) and this
 * module never echoes them back once stored.
 */
export class PushSubscriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  user_agent: string | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ nullable: true })
  last_used_at: Date | null;
}
