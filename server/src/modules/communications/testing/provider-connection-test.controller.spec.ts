import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AuditAction, CommunicationMedium, type JwtPayload } from '@biddaloy/shared';
import { ProviderConnectionTestController } from './provider-connection-test.controller';
import { ConnectionTestService } from './connection-test.service';
import { AuditService } from '../../audit/audit.service';
import { TestConnectionDto } from '../dto/test-connection.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeConnectionTestService() {
  return { test: vi.fn() };
}

function fakeAuditService() {
  return { record: vi.fn() };
}

describe('ProviderConnectionTestController', () => {
  let connectionTest: ReturnType<typeof fakeConnectionTestService>;
  let auditService: ReturnType<typeof fakeAuditService>;
  let controller: ProviderConnectionTestController;

  beforeEach(() => {
    connectionTest = fakeConnectionTestService();
    auditService = fakeAuditService();
    controller = new ProviderConnectionTestController(
      connectionTest as unknown as ConnectionTestService,
      auditService as unknown as AuditService,
    );
  });

  function dto(): TestConnectionDto {
    const d = new TestConnectionDto();
    d.medium = CommunicationMedium.WHATSAPP;
    d.config = { accessToken: 'draft-token' };
    return d;
  }

  it('delegates to the service when an ADMIN tests their own school', async () => {
    connectionTest.test.mockResolvedValue({ success: true, message: 'ok' });

    const result = await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      undefined,
    );
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('delegates for a SUPER_ADMIN testing a school outside their own tenant', async () => {
    connectionTest.test.mockResolvedValue({ success: true, message: 'ok' });

    await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_B, role: 'SUPER_ADMIN' },
      USER,
      REQUEST,
    );

    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      undefined,
    );
  });

  it('rejects an ADMIN testing a different school, without calling the service at all', async () => {
    await expect(
      controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_B, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toThrow(ForbiddenException);
    expect(connectionTest.test).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('never echoes the submitted config back in the response', async () => {
    connectionTest.test.mockResolvedValue({ success: false, message: 'Authentication rejected.' });

    const result = await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(JSON.stringify(result)).not.toContain('draft-token');
  });

  it('writes a SETTINGS_TEST audit entry with actor/tenant/medium/outcome, never the config or a credential', async () => {
    connectionTest.test.mockResolvedValue({ success: false, message: 'Authentication rejected.' });

    await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const [entry] = auditService.record.mock.calls[0];
    expect(entry).toMatchObject({
      action: AuditAction.SETTINGS_TEST,
      entity_type: 'School',
      entity_id: SCHOOL_A,
      tenant_id: SCHOOL_A,
      performed_by_user_id: 'user-1',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      new_values: { medium: CommunicationMedium.WHATSAPP, success: false },
    });
    expect(JSON.stringify(entry)).not.toContain('draft-token');
  });

  it('requires an Idempotency-Key when sendTo is set (Rule 25)', async () => {
    const d = dto();
    d.sendTo = '01712345678';
    await expect(
      controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(connectionTest.test).not.toHaveBeenCalled();
  });

  it('passes sendTo and the caller to the service, and audits only the log id', async () => {
    connectionTest.test.mockResolvedValue({
      success: true,
      message: 'ok',
      testMessage: { logId: 'log-9', status: 'SENT' },
    });
    const d = dto();
    d.sendTo = '01712345678';
    const keyed = { ...REQUEST, headers: { 'idempotency-key': 'k1' } } as unknown as Request;
    await controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, keyed);
    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      { sendTo: '01712345678', userId: 'user-1' },
    );
    const audit = JSON.stringify(auditService.record.mock.calls[0][0]);
    expect(audit).toContain('log-9');
    expect(audit).not.toContain('01712345678');
  });

  it('is throttled at the test tier (3/min); the global tracker buckets per authenticated user', () => {
    // Tracker is `user:<sub>` (rate-limit-tracker.ts), not per tenant: a tenant key would come from
    // the unauthenticated URL and let a stranger lock a school out. The tenant-wide abuse cap is the
    // daily test-send cap in ConnectionTestService.
    const handler = ProviderConnectionTestController.prototype.testConnection;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
