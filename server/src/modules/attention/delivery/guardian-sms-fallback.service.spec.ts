import { describe, it, expect, vi } from 'vitest';
import {
  GuardianSmsFallbackService,
  fallbackReferenceKey,
  toldAboutStudent,
} from './guardian-sms-fallback.service';

const S1 = 'student-1';
const S2 = 'student-2';
const G = 'guardian-1';

describe('toldAboutStudent', () => {
  it('matches the log student, or any student named in metadata.student_ids', () => {
    expect(toldAboutStudent([{ guardian_id: G, student_id: S1, metadata: null }], G, S1)).toBe(
      true,
    );
    // one absence log can name several children
    expect(
      toldAboutStudent(
        [{ guardian_id: G, student_id: null, metadata: { student_ids: [S1, S2] } }],
        G,
        S2,
      ),
    ).toBe(true);
  });

  it('does not match another student or another guardian', () => {
    expect(
      toldAboutStudent([{ guardian_id: G, student_id: S2, metadata: { student_ids: [] } }], G, S1),
    ).toBe(false);
    expect(
      toldAboutStudent([{ guardian_id: 'other', student_id: S1, metadata: null }], G, S1),
    ).toBe(false);
    expect(toldAboutStudent([], G, S1)).toBe(false);
  });
});

describe('fallbackReferenceKey', () => {
  it('is stable per alert and guardian (the idempotency key)', () => {
    expect(fallbackReferenceKey('a1', 'g1')).toBe('attention:a1:g1');
  });
});

describe('GuardianSmsFallbackService gates', () => {
  const build = (query = vi.fn().mockResolvedValue([])) => {
    const service = new GuardianSmsFallbackService(
      {
        query,
        getRepository: vi.fn(),
        // the per-tenant advisory lock is always granted here
        createQueryRunner: () => ({
          connect: vi.fn(),
          query: vi.fn().mockResolvedValue([{ ok: true }]),
          release: vi.fn(),
        }),
      } as any,
      { add: vi.fn() } as any,
      { isMetered: vi.fn(), reserve: vi.fn() } as any,
      { get: vi.fn() } as any,
    );
    return { service, query };
  };
  const school = (settings: object) => ({ id: 't1', name: 'S', name_bn: null, settings });
  const on = { guardianSmsFallback: true, quietHours: { start: '00:00', end: '00:00' } };

  it('does nothing (not even a query) when the school has not opted in', async () => {
    const { service, query } = build();
    expect(
      await service.runTenant(school({ communications: { sms: { provider: 'x' } } }), new Date()),
    ).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing without an SMS provider', async () => {
    const { service, query } = build();
    expect(await service.runTenant(school({ attention: on }), new Date())).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing inside quiet hours; the next sweep outside them sends', async () => {
    const { service, query } = build();
    const settings = {
      communications: { sms: { provider: 'x' } },
      attention: { ...on, quietHours: { start: '00:00', end: '23:59' } },
    };
    // 06:00 UTC is 12:00 in Dhaka: inside 00:00-23:59
    expect(await service.runTenant(school(settings), new Date('2026-10-10T06:00:00Z'))).toBe(0);
    expect(query).not.toHaveBeenCalled();
    // 17:59 UTC is 23:59 in Dhaka: outside -> the alert query runs
    await service.runTenant(school(settings), new Date('2026-10-10T17:59:00Z'));
    expect(query).toHaveBeenCalled();
  });

  it('one failing school never stops the others', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        school({ communications: { sms: { provider: 'x' } }, attention: on }),
        { ...school({}), id: 't2' },
      ])
      .mockRejectedValueOnce(new Error('db down'));
    const { service } = build(query);
    await expect(service.run(new Date())).resolves.toBeUndefined();
  });
});
