import { describe, it, expect, vi } from 'vitest';
import { AttendanceStatus } from '@biddaloy/shared';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';

/**
 * Unit test for `revertLeaveRange` with a mocked manager (#2381). The real
 * SQL is covered by `leave.service.integration.spec.ts`.
 */
describe('StaffAttendanceService.revertLeaveRange (unit)', () => {
  it('puts a turned ABSENT back, deletes the SYSTEM LEAVE mark, and returns both dates sorted', async () => {
    const auditService = { record: vi.fn().mockResolvedValue(undefined) };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ region: { timezone: 'UTC' } }),
    };
    const recordRepo = {
      update: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(() => {
        const qb: any = {};
        for (const m of ['innerJoinAndSelect', 'setLock', 'where', 'andWhere', 'orderBy'])
          qb[m] = vi.fn(() => qb);
        qb.getMany = vi
          .fn()
          .mockResolvedValue([{ id: 'sys', session_id: 's1', session: { date: '2020-01-01' } }]);
        return qb;
      }),
    };
    const sessionRepo = { increment: vi.fn() };
    const manager: any = {
      query: vi.fn().mockResolvedValue([{ id: 'abs', session_id: 's2', date: '2020-01-02' }]),
      getRepository: (e: unknown) => (e === StaffAttendanceRecord ? recordRepo : sessionRepo),
    };
    const service = new StaffAttendanceService(
      {} as any,
      auditService as any,
      schoolsService as any,
      {} as any,
      {} as any,
    );

    const result = await service.revertLeaveRange(manager, {
      tenantId: 't1',
      staffProfileId: 'sp1',
      from: '2020-01-01',
      to: '2020-01-02',
      actorUserId: 'u1',
      applicationId: 'app1',
      includePast: true,
    });

    // Only this leave's audit rows count, and only in this tenant.
    const params = manager.query.mock.calls[0][1];
    expect(params[0]).toBe('t1');
    expect(params).toContain('app1');
    expect(recordRepo.update).toHaveBeenCalledWith(
      { id: 'abs', tenant_id: 't1' },
      { status: AttendanceStatus.ABSENT },
    );
    expect(recordRepo.delete).toHaveBeenCalledWith({ id: 'sys', tenant_id: 't1' });
    expect(recordRepo.delete).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'abs' }));
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: 'abs',
        old_values: { status: AttendanceStatus.LEAVE },
        new_values: { status: AttendanceStatus.ABSENT, application_id: 'app1' },
      }),
      manager,
    );
    expect(result.dates).toEqual(['2020-01-01', '2020-01-02']);
  });
});
