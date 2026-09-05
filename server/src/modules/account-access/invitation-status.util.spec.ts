import { describe, it, expect } from 'vitest';
import { AuthTokenPurpose } from '@biddaloy/shared';
import { deriveInvitationStatus } from './invitation-status.util';
import type { AuthToken } from './entities/auth-token.entity';

function buildToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    id: 'token-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    purpose: AuthTokenPurpose.INVITE,
    token_hash: 'hash',
    expires_at: new Date(Date.now() + 100_000),
    consumed_at: null,
    revoked_at: null,
    created_by_user_id: null,
    metadata: null,
    created_at: new Date(),
    ...overrides,
  } as AuthToken;
}

describe('deriveInvitationStatus', () => {
  it('ACTIVATED when the user already has a password, regardless of any token', () => {
    expect(deriveInvitationStatus({ password_hash: 'hash' }, null)).toBe('ACTIVATED');
    expect(
      deriveInvitationStatus({ password_hash: 'hash' }, buildToken({ revoked_at: new Date() })),
    ).toBe('ACTIVATED');
  });

  it('NONE when there is no password and no invite was ever issued', () => {
    expect(deriveInvitationStatus({ password_hash: null }, null)).toBe('NONE');
  });

  it('PENDING when the newest invite is still live', () => {
    const token = buildToken({ expires_at: new Date(Date.now() + 100_000) });
    expect(deriveInvitationStatus({ password_hash: null }, token)).toBe('PENDING');
  });

  it('EXPIRED when the newest invite is past expiry and never consumed', () => {
    const token = buildToken({ expires_at: new Date(Date.now() - 1_000) });
    expect(deriveInvitationStatus({ password_hash: null }, token)).toBe('EXPIRED');
  });

  it('REVOKED when the newest invite was revoked', () => {
    const token = buildToken({ revoked_at: new Date() });
    expect(deriveInvitationStatus({ password_hash: null }, token)).toBe('REVOKED');
  });

  it('ACTIVATED (via token) when the newest invite was consumed', () => {
    const token = buildToken({ consumed_at: new Date() });
    expect(deriveInvitationStatus({ password_hash: null }, token)).toBe('ACTIVATED');
  });
});
