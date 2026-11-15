import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { syncLinkedGuardianContactsFromLogin } from './linked-guardian-contacts.util';

describe('syncLinkedGuardianContactsFromLogin', () => {
  it('reads the login contact under a row lock, then copies it to the guardian rows', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'u1', phone: '01711111111', email: null });
    const update = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: { name: string }) =>
        entity.name === 'User' ? { findOne } : { update },
    } as unknown as EntityManager;

    await syncLinkedGuardianContactsFromLogin(manager, 'u1');

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'for_no_key_update' } }),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1' }), {
      phone: '01711111111',
    });
  });
});
