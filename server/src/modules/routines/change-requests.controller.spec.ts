import { describe, it, expect, vi } from 'vitest';
import { ChangeRequestsController } from './change-requests.controller';
import { ChangeRequestState } from '@biddaloy/shared';

const TENANT = { id: 'tenant-1', role: 'TEACHER' };
const USER = { sub: 'user-1' } as any;

describe('ChangeRequestsController [21.6.1]', () => {
  it('open delegates to the service with the tenant and caller ids', async () => {
    const service: any = { open: vi.fn(async () => ({ id: 'cr-1' })) };
    const controller = new ChangeRequestsController(service);
    await controller.open('slot-1', { note: 'move it' }, TENANT, USER);
    expect(service.open).toHaveBeenCalledWith('slot-1', { note: 'move it' }, 'tenant-1', 'user-1');
  });

  it('findForRoutine delegates to the service scoped to the tenant', async () => {
    const service: any = { findForRoutine: vi.fn(async () => []) };
    const controller = new ChangeRequestsController(service);
    await controller.findForRoutine('routine-1', { id: 'tenant-1', role: 'ADMIN' });
    expect(service.findForRoutine).toHaveBeenCalledWith('routine-1', 'tenant-1');
  });

  it('resolve delegates to the service with a request context', async () => {
    const service: any = { resolve: vi.fn(async () => ({ id: 'cr-1' })) };
    const controller = new ChangeRequestsController(service);
    const req: any = { ip: '1.2.3.4', headers: {} };
    await controller.resolve(
      'cr-1',
      { state: ChangeRequestState.ACCEPTED },
      { id: 'tenant-1', role: 'ADMIN' },
      USER,
      req,
    );
    expect(service.resolve).toHaveBeenCalledWith(
      'cr-1',
      { state: ChangeRequestState.ACCEPTED },
      'tenant-1',
      'user-1',
      expect.objectContaining({ ip: '1.2.3.4' }),
    );
  });
});
