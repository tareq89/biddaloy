import { describe, it, expect } from 'vitest';
import { applyGuardError } from './reconcile-sms-credit';

describe('applyGuardError (#1317 wrong-DB guard)', () => {
  it('never blocks a dry run', () => {
    expect(applyGuardError(false, undefined, 'biddaloy')).toBeNull();
    expect(applyGuardError(false, 'other', 'biddaloy')).toBeNull();
  });

  it('refuses --apply without --confirm-db', () => {
    expect(applyGuardError(true, undefined, 'biddaloy')).toContain('--confirm-db=biddaloy');
  });

  it('refuses --apply when --confirm-db names a different database', () => {
    expect(applyGuardError(true, 'biddaloy_staging', 'biddaloy')).toContain('"biddaloy"');
  });

  it('allows --apply when --confirm-db equals current_database()', () => {
    expect(applyGuardError(true, 'biddaloy', 'biddaloy')).toBeNull();
  });
});
