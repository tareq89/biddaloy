import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePushSubscriptionDto } from './push-subscription.dto';

const validKeys = { p256dh: 'p1', auth: 'a1' };

describe('CreatePushSubscriptionDto', () => {
  it('passes with a real push service endpoint', async () => {
    const dto = plainToInstance(CreatePushSubscriptionDto, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: validKeys,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an endpoint on a host that is not a known push service', async () => {
    // The SSRF case: `endpoint` is later passed straight into
    // webpush.sendNotification() (push.service.ts), so an unlisted host
    // must never pass.
    const dto = plainToInstance(CreatePushSubscriptionDto, {
      endpoint: 'https://internal.example/metadata',
      keys: validKeys,
    });
    const errors = await validate(dto);
    expect(errors.some((err) => err.property === 'endpoint')).toBe(true);
  });

  it('rejects a non-HTTPS endpoint on an otherwise allowed host', async () => {
    const dto = plainToInstance(CreatePushSubscriptionDto, {
      endpoint: 'http://fcm.googleapis.com/fcm/send/abc123',
      keys: validKeys,
    });
    const errors = await validate(dto);
    expect(errors.some((err) => err.property === 'endpoint')).toBe(true);
  });

  it('rejects a missing keys object', async () => {
    // @ValidateNested() alone skips undefined — without @IsDefined()
    // @IsObject(), a body with no `keys` would reach
    // PushSubscriptionsService.subscribe and crash on `dto.keys.p256dh`.
    const dto = plainToInstance(CreatePushSubscriptionDto, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    });
    const errors = await validate(dto);
    expect(errors.some((err) => err.property === 'keys')).toBe(true);
  });

  it('rejects a non-object keys value', async () => {
    const dto = plainToInstance(CreatePushSubscriptionDto, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: 'not-an-object',
    });
    const errors = await validate(dto);
    expect(errors.some((err) => err.property === 'keys')).toBe(true);
  });
});
