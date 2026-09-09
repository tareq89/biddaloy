import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_URL,
  isSameOriginPath,
  parsePushPayload,
  pickClientOrOpen,
} from './sw-push';

describe('isSameOriginPath', () => {
  it('accepts a same-origin path', () => {
    expect(isSameOriginPath('/portal/invoices/123')).toBe(true);
  });

  it('rejects an absolute URL with a scheme', () => {
    expect(isSameOriginPath('https://evil.com/x')).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isSameOriginPath('//evil.com')).toBe(false);
  });

  it('rejects a backslash that browsers normalize to a protocol-relative URL', () => {
    expect(isSameOriginPath('/\\evil.com')).toBe(false);
  });

  it('rejects a javascript: URL', () => {
    expect(isSameOriginPath('javascript:alert(1)')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isSameOriginPath(123)).toBe(false);
    expect(isSameOriginPath(undefined)).toBe(false);
  });

  it('rejects a path with no leading slash', () => {
    expect(isSameOriginPath('portal')).toBe(false);
  });
});

describe('parsePushPayload', () => {
  const valid = { type: 'fee-due', title: 'Fee due', body: 'Pay by Friday', url: '/portal/fees' };

  it('accepts a fully-formed payload', () => {
    expect(parsePushPayload(valid)).toEqual(valid);
  });

  it('rejects a missing field', () => {
    const rest = { type: valid.type, title: valid.title, body: valid.body };
    expect(parsePushPayload(rest)).toBeNull();
  });

  it('rejects a non-string field', () => {
    expect(parsePushPayload({ ...valid, title: 42 })).toBeNull();
  });

  it('rejects a bad url', () => {
    expect(parsePushPayload({ ...valid, url: 'https://evil.com/x' })).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload('string')).toBeNull();
  });
});

describe('pickClientOrOpen', () => {
  it('chooses openWindow when there are no clients', () => {
    const decision = pickClientOrOpen([], '/portal/fees');
    expect(decision).toEqual({ kind: 'open', url: '/portal/fees' });
  });

  it('chooses focus with the first client when none match the target url', () => {
    const clients = [{ url: '/dashboard' }, { url: '/students' }];
    const decision = pickClientOrOpen(clients, '/portal/fees');
    expect(decision.kind).toBe('focus');
    expect(decision.client).toBe(clients[0]);
    expect(decision.url).toBe('/portal/fees');
  });

  it('prefers a client already at the target url', () => {
    const clients = [{ url: '/dashboard' }, { url: '/portal/fees' }];
    const decision = pickClientOrOpen(clients, '/portal/fees');
    expect(decision.kind).toBe('focus');
    expect(decision.client).toBe(clients[1]);
  });

  it('defaults the url to /portal when none is given', () => {
    const decision = pickClientOrOpen([], undefined);
    expect(decision.url).toBe(DEFAULT_NOTIFICATION_URL);
  });
});
