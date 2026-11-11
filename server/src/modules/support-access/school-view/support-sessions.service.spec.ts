import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImpersonationEndedBy } from '@biddaloy/shared';
import { SupportSessionsService } from './support-sessions.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const SID = '33333333-3333-4333-8333-333333333333';

describe('SupportSessionsService', () => {
  const query = vi.fn();
  const findOneByOrFail = vi.fn();
  const end = vi.fn();
  let svc: SupportSessionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new SupportSessionsService({ query, findOneByOrFail } as never, { end } as never);
  });

  it('an ACTIVE row past expires_at is shown EXPIRED (D31); changedCount defaults to 0', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: SID,
          owner_name: 'Owner',
          started_at: new Date(),
          requested_at: new Date(),
          ended_at: null,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() - 1000),
          entry_kind: 'EMERGENCY',
          view_only: true,
          role: 'TEACHER',
          person_name: 'T',
          reason: 'help',
        },
      ])
      .mockResolvedValueOnce([]);
    const [item] = await svc.listSessions(SCHOOL);
    expect(item).toMatchObject({ status: 'EXPIRED', kind: 'EMERGENCY', changedCount: 0 });
  });

  it('passes the school, a 90 day window and the page offset; limit is capped at 100', async () => {
    query.mockResolvedValueOnce([]);
    await svc.listSessions(SCHOOL, { days: 400, page: 3, limit: 5000 });
    expect(query.mock.calls[0][1]).toEqual([SCHOOL, 90, 100, 200]);
  });

  it('a foreign or unknown session is 404 and end() never runs', async () => {
    query.mockResolvedValueOnce([]);
    await expect(svc.end(SCHOOL, SID)).rejects.toMatchObject({ status: 404 });
    expect(end).not.toHaveBeenCalled();
  });

  it('end records SCHOOL_ADMIN and answers the current status', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    end.mockResolvedValueOnce(false); // already over: still 200
    findOneByOrFail.mockResolvedValueOnce({ status: 'ENDED', expires_at: null });
    await expect(svc.end(SCHOOL, SID)).resolves.toEqual({ id: SID, status: 'ENDED' });
    expect(end).toHaveBeenCalledWith(SID, ImpersonationEndedBy.SCHOOL_ADMIN);
  });
});
