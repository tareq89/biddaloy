import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Real browser push services all live under one of these hosts. `endpoint`
 * is later handed straight to `webpush.sendNotification()`
 * (`push.service.ts`) — without this allowlist, an authenticated caller
 * could register an arbitrary internal URL and turn this server into an
 * SSRF proxy against it.
 */
const ALLOWED_PUSH_ENDPOINT_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Firefox (via FCM), Edge (Chromium)
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)notify\.windows\.com$/, // legacy Edge/WNS
  /(^|\.)push\.apple\.com$/, // Safari
];

function isAllowedPushEndpoint(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_ENDPOINT_HOSTS.some((pattern) => pattern.test(url.hostname));
}

/** Restricts a push subscription's `endpoint` to a known, HTTPS-only push
 * service host — `@IsUrl()` alone only validates URL syntax, not the host. */
function IsPushServiceEndpoint(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPushServiceEndpoint',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: isAllowedPushEndpoint,
        defaultMessage: () => 'endpoint must be an HTTPS URL on a supported push service host',
      },
    });
  };
}

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
  @IsPushServiceEndpoint()
  endpoint: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsDefined()
  @IsObject()
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
