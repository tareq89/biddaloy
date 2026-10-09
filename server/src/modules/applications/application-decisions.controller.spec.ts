import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Permission } from '@biddaloy/shared';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import { ApplicationDecisionsController } from './application-decisions.controller';
import {
  ApproveApplicationDto,
  BulkApproveDto,
  CancelApplicationDto,
  RejectApplicationDto,
} from './dto/decide.dto';

const proto = ApplicationDecisionsController.prototype;
const failures = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).length;

describe('ApplicationDecisionsController', () => {
  it('approve declares APPLICATION_SUBMIT (the catalogue decides the rest)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.approve)).toEqual([
      Permission.APPLICATION_SUBMIT,
    ]);
  });

  it('reject declares APPLICATION_SUBMIT (the catalogue decides the rest)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.reject)).toEqual([
      Permission.APPLICATION_SUBMIT,
    ]);
  });

  it('consider declares APPLICATION_SUBMIT (the catalogue decides the rest)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.consider)).toEqual([
      Permission.APPLICATION_SUBMIT,
    ]);
  });

  it('cancel declares APPLICATION_SUBMIT (the catalogue decides the rest)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.cancel)).toEqual([
      Permission.APPLICATION_SUBMIT,
    ]);
  });

  it('bulkApprove declares APPLICATION_SUBMIT (the catalogue decides the rest)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.bulkApprove)).toEqual([
      Permission.APPLICATION_SUBMIT,
    ]);
  });

  it('BulkApproveDto rejects 0, 51, duplicate and non-UUID ids, and accepts 1..50 unique', async () => {
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
    expect(await failures(BulkApproveDto, { ids: [] })).toBeGreaterThan(0);
    expect(await failures(BulkApproveDto, { ids: ids(51) })).toBeGreaterThan(0);
    const dup = randomUUID();
    expect(await failures(BulkApproveDto, { ids: [dup, dup] })).toBeGreaterThan(0);
    expect(await failures(BulkApproveDto, { ids: ['not-a-uuid'] })).toBeGreaterThan(0);
    expect(await failures(BulkApproveDto, { ids: ids(50) })).toBe(0);
  });

  it('RejectApplicationDto and CancelApplicationDto require a non-empty reason', async () => {
    for (const cls of [RejectApplicationDto, CancelApplicationDto]) {
      expect(await failures(cls, {})).toBeGreaterThan(0);
      expect(await failures(cls, { reason: '' })).toBeGreaterThan(0);
      expect(await failures(cls, { reason: '   ' })).toBeGreaterThan(0); // trimmed to empty
      expect(await failures(cls, { reason: 'Because' })).toBe(0);
    }
  });

  it('ApproveApplicationDto validates a nested granted block', async () => {
    expect(await failures(ApproveApplicationDto, { note: 'ok' })).toBe(0);
    expect(await failures(ApproveApplicationDto, { granted: { kind: 'PERCENT', value: 50 } })).toBe(
      0,
    );
    expect(
      await failures(ApproveApplicationDto, { granted: { kind: 'BOGUS', value: 50 } }),
    ).toBeGreaterThan(0);
  });
});
