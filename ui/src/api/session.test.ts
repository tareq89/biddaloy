import type { JwtMembership } from '@biddaloy/shared';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAuthState, getActiveRole, getActiveTenant } from './auth-state';
import { ensureSessionLoaded, resetSessionBootstrap } from './session';
import { clearPersistedTenant, persistTenant } from './tenant-storage';

/**
 * [8.9.5]'s cold-boot tenant-restore tests — split out from `session.spec.ts`
 * (which runs under the no-jsdom `ui:node` project) specifically because
 * this behavior is backed by a real `localStorage`, which that project
 * doesn't provide (see `locale-storage.spec.ts`'s own comment on the same
 * split). Everything else about `session.ts` stays covered in
 * `session.spec.ts`; this file only covers `restoreActiveTenant`.
 */
let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(axios);
});

afterEach(() => {
  mock.restore();
  clearAuthState();
  clearPersistedTenant();
  resetSessionBootstrap();
});

/** See `session.spec.ts`'s own `fakeJwt`/`encodeBase64UrlFromString` for
 * why no real signature is needed, and why this encodes via `TextEncoder`
 * rather than handing `btoa` the JSON string directly. */
function fakeJwt(expUnixSeconds: number, memberships: JwtMembership[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ exp: expUnixSeconds, memberships }));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('ensureSessionLoaded restores the active tenant [8.9.5]', () => {
  const schoolA: JwtMembership = {
    tenantId: 'tenant-a',
    role: 'ADMIN' as never,
    name: 'Greenview School',
  };
  const schoolB: JwtMembership = {
    tenantId: 'tenant-b',
    role: 'TEACHER' as never,
    name: 'Rose Valley School',
  };

  it('restores a persisted tenant that is still among the fresh memberships', async () => {
    persistTenant('tenant-b');
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, schoolB]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBe('tenant-b');
    expect(getActiveRole()).toBe('TEACHER');
  });

  it('drops a persisted tenant no longer among the fresh memberships, rather than restoring it', async () => {
    persistTenant('tenant-removed');
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, schoolB]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBeNull();
  });

  it('auto-picks a lone membership when nothing is persisted, mirroring login()', async () => {
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBe('tenant-a');
    expect(getActiveRole()).toBe('ADMIN');
  });

  // [8.9.11]: a membership is a `{tenantId, role}` pair, so restore has to
  // match on both — one user can hold two roles at the *same* school.
  const parentAtSchoolA: JwtMembership = {
    tenantId: 'tenant-a',
    role: 'PARENT' as never,
    name: 'Greenview School',
  };

  it('restores the exact role chosen at a school where the user holds two [8.9.11]', async () => {
    persistTenant('tenant-a', 'PARENT');
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, parentAtSchoolA]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBe('tenant-a');
    // ADMIN is listed first and would have won a tenant-only match.
    expect(getActiveRole()).toBe('PARENT');
  });

  it('drops a persisted role revoked since the last visit, rather than restoring it [8.9.11]', async () => {
    persistTenant('tenant-a', 'PARENT');
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, schoolB]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
  });

  it('restores a pre-[8.9.11] roleless value by matching the tenant alone', async () => {
    // What a returning user's browser still holds — a bare tenant id, no
    // role. Degrades to exactly the pre-[8.9.11] behaviour instead of
    // discarding the choice or crashing the bootstrap.
    persistTenant('tenant-b');
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, schoolB]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBe('tenant-b');
    expect(getActiveRole()).toBe('TEACHER');
  });

  it('leaves the active tenant unset for 2+ unresolved memberships — the picker route handles it', async () => {
    mock
      .onPost('/api/v1/auth/refresh')
      .reply(200, { access_token: fakeJwt(9_999_999_999, [schoolA, schoolB]) });

    await ensureSessionLoaded();

    expect(getActiveTenant()).toBeNull();
  });
});
