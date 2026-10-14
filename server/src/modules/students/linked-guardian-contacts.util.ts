import { IsNull, type EntityManager } from 'typeorm';
import { Guardian } from './entities/guardian.entity';

/**
 * [68.4.05] `users` owns a linked guardian's phone and email (what sign-in,
 * OTP and recovery read). This copies a change to that person's guardian rows
 * in every school, so the number school SMS dial can never drift from the login.
 * Call it in the same transaction as the `users` update.
 *
 * No tenant filter on purpose: it is the person's own verified contact, and
 * `user_id` already pins the rows to them. Only keys present in `values` are
 * written (`null` clears).
 */
export async function syncLinkedGuardianContacts(
  manager: EntityManager,
  userId: string,
  values: { phone?: string | null; email?: string | null },
): Promise<void> {
  const set: { phone?: string | null; email?: string | null } = {};
  if (values.phone !== undefined) set.phone = values.phone;
  if (values.email !== undefined) set.email = values.email;
  if (Object.keys(set).length === 0) return;
  await manager.getRepository(Guardian).update({ user_id: userId, deleted_at: IsNull() }, set);
}
