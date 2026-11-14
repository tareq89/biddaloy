import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { buildValidationPipeOptions } from '../../../../validation-pipe';
import { CreateSmsBundleOrderDto } from './sms-bundle-orders.dto';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const pipe = new ValidationPipe(buildValidationPipeOptions());
const run = (v: unknown) =>
  pipe.transform(v, { type: 'body', metatype: CreateSmsBundleOrderDto, data: '' });

describe('CreateSmsBundleOrderDto', () => {
  it('accepts a package id and a key', async () => {
    await expect(run({ package_id: U1, idempotency_key: U2 })).resolves.toBeTruthy();
  });
  it('refuses a missing or malformed key and package', async () => {
    await expect(run({ package_id: U1 })).rejects.toThrow();
    await expect(run({ package_id: U1, idempotency_key: 'x' })).rejects.toThrow();
    await expect(run({ idempotency_key: U2 })).rejects.toThrow();
    await expect(run({ package_id: 'x', idempotency_key: U2 })).rejects.toThrow();
  });
  it('refuses an unknown field such as a client price', async () => {
    await expect(run({ package_id: U1, idempotency_key: U2, price_paisa: 1 })).rejects.toThrow();
  });
});
