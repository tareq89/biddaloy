import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CommunicationMedium } from '@beton-boi/shared';
import { ProviderConnectionTestController } from './provider-connection-test.controller';
import { ConnectionTestService } from './connection-test.service';
import { TestConnectionDto } from '../dto/test-connection.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function fakeService() {
  return { test: vi.fn() };
}

describe('ProviderConnectionTestController', () => {
  let service: ReturnType<typeof fakeService>;
  let controller: ProviderConnectionTestController;

  beforeEach(() => {
    service = fakeService();
    controller = new ProviderConnectionTestController(service as unknown as ConnectionTestService);
  });

  function dto(): TestConnectionDto {
    const d = new TestConnectionDto();
    d.medium = CommunicationMedium.WHATSAPP;
    d.config = { accessToken: 'draft-token' };
    return d;
  }

  it('delegates to the service when an ADMIN tests their own school', async () => {
    service.test.mockResolvedValue({ success: true, message: 'ok' });

    const result = await controller.testConnection(SCHOOL_A, dto(), {
      id: SCHOOL_A,
      role: 'ADMIN',
    });

    expect(service.test).toHaveBeenCalledWith(SCHOOL_A, CommunicationMedium.WHATSAPP, {
      accessToken: 'draft-token',
    });
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('delegates for a SUPER_ADMIN testing a school outside their own tenant', async () => {
    service.test.mockResolvedValue({ success: true, message: 'ok' });

    await controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_B, role: 'SUPER_ADMIN' });

    expect(service.test).toHaveBeenCalledWith(SCHOOL_A, CommunicationMedium.WHATSAPP, {
      accessToken: 'draft-token',
    });
  });

  it('rejects an ADMIN testing a different school, without calling the service at all', async () => {
    await expect(
      controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_B, role: 'ADMIN' }),
    ).rejects.toThrow(ForbiddenException);
    expect(service.test).not.toHaveBeenCalled();
  });

  it('never echoes the submitted config back in the response', async () => {
    service.test.mockResolvedValue({ success: false, message: 'Authentication rejected.' });

    const result = await controller.testConnection(SCHOOL_A, dto(), {
      id: SCHOOL_A,
      role: 'ADMIN',
    });

    expect(JSON.stringify(result)).not.toContain('draft-token');
  });
});
