import { describe, it, expect, vi } from 'vitest';
import { renderNotice, type AdminNoticeKey } from '../../schools/trial/admin-notice-templates';
import { SupportAccessNoticeService } from './support-access-notice.service';

const KEYS: AdminNoticeKey[] = [
  'support_session_started',
  'support_emergency',
  'support_request',
  'support_mode_changed',
];

describe('support admin notice templates', () => {
  it('renders in bn and en with all vars and no never-say word, code or #', () => {
    for (const key of KEYS) {
      for (const locale of ['bn', 'en'] as const) {
        const out = renderNotice(key, locale, {
          school: 'Rose',
          person: 'Rafi',
          role: 'Admin',
          reason: 'x',
          time: '10:00',
          mode: 'ask',
          link: 'https://app.test/support-access/requests/1',
        });
        const text = `${out.subject} ${out.body}`;
        expect(text).toContain('Rose');
        expect(text).not.toMatch(
          /impersonat|act as|break-glass|consent|session|revoke|\bmode\b|\{\{|#/i,
        );
      }
    }
  });
});

describe('SupportAccessNoticeService (unit)', () => {
  const entry = { person: 'Rafi', role: 'Admin', reason: 'x', time: '10:00' };
  const make = (boom = false) => {
    const adminNotice = {
      notifyAdmins: vi.fn().mockImplementation(async () => {
        if (boom) throw new Error('secret@address');
      }),
    };
    const delivery = { deliver: vi.fn().mockResolvedValue({}) };
    const config = { get: () => undefined };
    const svc = new SupportAccessNoticeService(
      adminNotice as never,
      delivery as never,
      config as never,
    );
    return { svc, adminNotice, delivery };
  };

  it('never fails the caller when a send throws', async () => {
    const { svc } = make(true);
    await expect(svc.sessionStarted('s1', entry)).resolves.toBeUndefined();
    await expect(svc.emergency('s1', entry)).resolves.toBeUndefined();
  });

  it('sessionStarted and modeChanged are email only; modeChanged skips the actor', async () => {
    const { svc, adminNotice } = make();
    await svc.sessionStarted('s1', entry);
    expect(adminNotice.notifyAdmins.mock.calls[0][3]).toEqual({ emailOnly: true });
    await svc.modeChanged('s1', { person: 'A', mode: 'off', time: 't', changedByUserId: 'u1' });
    expect(adminNotice.notifyAdmins.mock.calls[1][3]).toEqual({
      emailOnly: true,
      exceptUserId: 'u1',
    });
  });

  it('requestToAdmins links to the request page; emergency is not email only', async () => {
    const { svc, adminNotice } = make();
    await svc.requestToAdmins('s1', 'r-1', entry);
    expect(adminNotice.notifyAdmins.mock.calls[0][2].link).toBe(
      'http://localhost:5174/support-access/requests/r-1',
    );
    await svc.emergency('s1', entry);
    expect(adminNotice.notifyAdmins.mock.calls[1][3]).toBeUndefined();
  });

  it('owner notice goes to both owners as the platform; one failure does not stop the rest', async () => {
    const { svc, delivery } = make();
    delivery.deliver.mockRejectedValueOnce(new Error('x'));
    await svc.ownersSessionStarted(
      [
        { name: 'O1', email: 'a@x.test', phone: '01711' },
        { name: 'O2', email: 'b@x.test', phone: null },
      ],
      { ...entry, targetSchool: 'Rose' },
    );
    expect(delivery.deliver).toHaveBeenCalledTimes(3);
    expect(delivery.deliver.mock.calls.every((c) => c[0].tenantId === null)).toBe(true);
    expect(delivery.deliver.mock.calls[2][0].to).toBe('b@x.test');
  });

  it('ticketReady sends a cockpit link and no code', async () => {
    const { svc, delivery } = make();
    await svc.ticketReady({ name: 'O', email: 'a@x.test' }, 's1', 'Rose');
    const input = delivery.deliver.mock.calls[0][0];
    expect(input.kind).toBe('SUPPORT_TICKET_READY');
    expect(input.vars.link).toBe('http://localhost:5174/schools/s1');
    expect(input.vars.code).toBeUndefined();
  });
});
