import { describe, it, expect } from 'vitest';
import { RequestActorContext, stampAuditActor } from './request-actor-context';

const imp = { sid: 'sess-1', pa: 'pa-1' };

describe('RequestActorContext', () => {
  it('keeps the store across an await and a setTimeout', async () => {
    await RequestActorContext.run(async () => {
      RequestActorContext.setImpersonation(imp);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 5));
      expect(RequestActorContext.impersonation()).toEqual(imp);
    });
  });

  it('setImpersonation outside run throws (fail closed)', () => {
    expect(() => RequestActorContext.setImpersonation(imp)).toThrow(
      'request actor context missing',
    );
  });

  it('stampAuditActor outside a request does nothing', () => {
    expect(stampAuditActor({ a: 1 })).toEqual({ a: 1 });
  });

  it('stampAuditActor inside run without imp does nothing', () => {
    RequestActorContext.run(() => expect(stampAuditActor({ a: 1 })).toEqual({ a: 1 }));
  });

  it('stampAuditActor writes both columns when imp is set', () => {
    RequestActorContext.run(() => {
      RequestActorContext.setImpersonation(imp);
      expect(stampAuditActor({})).toEqual({
        impersonated_by_platform_admin_id: 'pa-1',
        impersonation_session_id: 'sess-1',
      });
    });
  });
});
