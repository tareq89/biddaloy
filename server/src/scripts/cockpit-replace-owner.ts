import 'reflect-metadata';
import * as os from 'os';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { User } from '../modules/users/entities/user.entity';
import { PlatformAdmin } from '../modules/platform-identity/entities/platform-admin.entity';
import { PlatformAdminDevice } from '../modules/platform-identity/entities/platform-admin-device.entity';
import { UserMfa } from '../modules/platform-identity/entities/user-mfa.entity';
import { UserRecoveryCode } from '../modules/platform-identity/entities/user-recovery-code.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { SessionCutoffService } from '../modules/auth/session-cutoff.service';
import { createScriptAppContext } from './script-app-context';

/**
 * Replaces one platform (cockpit) owner with another, audited. [Epic 98 #3737, D25]
 *
 *   node server/dist/scripts/cockpit-replace-owner.js \
 *     --old-email <email> --new-email <email> --new-phone <+E164>
 *
 * There is no password flag: the new owner sets their own with "Forgot password" on the
 * cockpit host. In one transaction it checks the old user is a platform admin and that another
 * ACTIVE owner remains, creates or loads the new user, adds their `platform_admins` row,
 * suspends the old user, deletes their MFA rows and devices, cuts their sessions, revokes their
 * refresh tokens, and writes `PLATFORM_OWNER_REPLACED` (tenant NULL, user ids only).
 *
 * After a replace, update `COCKPIT_OWNER_1_*` / `COCKPIT_OWNER_2_*` in the sops file for the
 * stack, or the next boot warns that the configured owner no longer matches.
 *
 * Output and errors carry user ids only: never an email, phone or password.
 */
export interface ReplaceOwnerInput {
  oldEmail: string;
  newEmail: string;
  newPhone: string;
}

export interface ReplaceOwnerResult {
  oldUserId: string;
  newUserId: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Input checks before the database is touched. Returns the first problem, or null. */
export function validateReplaceInput(input: ReplaceOwnerInput): string | null {
  if (!EMAIL.test(input.oldEmail.trim())) return '--old-email must be an email address';
  if (!EMAIL.test(input.newEmail.trim())) return '--new-email must be an email address';
  if (!E164.test(input.newPhone.trim())) return '--new-phone must be an E.164 phone number';
  if (input.oldEmail.trim().toLowerCase() === input.newEmail.trim().toLowerCase()) {
    return '--old-email and --new-email must differ';
  }
  return null;
}

/** OS user who ran the CLI, for the audit row; `os.userInfo()` throws when the uid has no passwd entry. */
export function operatorName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.LOGNAME || 'unknown';
  }
}

/** pg advisory lock key; serialises concurrent replaces so the "another owner remains" count is race-free. */
export const REPLACE_OWNER_LOCK_KEY = 98001001;

export async function replaceOwner(
  ds: DataSource,
  input: ReplaceOwnerInput,
): Promise<ReplaceOwnerResult> {
  const problem = validateReplaceInput(input);
  if (problem) throw new Error(problem);
  const oldEmail = input.oldEmail.trim().toLowerCase();
  const newEmail = input.newEmail.trim().toLowerCase();
  const newPhone = input.newPhone.trim();
  const operator = operatorName();

  return ds.transaction(async (em) => {
    await em.query('SELECT pg_advisory_xact_lock($1)', [REPLACE_OWNER_LOCK_KEY]);
    // users.email is globally unique (UQ constraint, not per tenant), so this lookup is unambiguous.
    const oldUser = await em.findOne(User, { where: { email: oldEmail } });
    const oldOwner =
      oldUser && (await em.findOne(PlatformAdmin, { where: { user_id: oldUser.id } }));
    if (!oldUser || !oldOwner) throw new Error('the old email is not a platform owner');

    // Another ACTIVE, unlocked owner must stay, or nobody could sign in to the cockpit.
    const others = await em
      .getRepository(PlatformAdmin)
      .createQueryBuilder('pa')
      .innerJoin('pa.user', 'u')
      .where('pa.user_id <> :id', { id: oldUser.id })
      .andWhere('pa.locked_at IS NULL')
      .andWhere('u.status = :active', { active: UserStatus.ACTIVE })
      .andWhere('u.deleted_at IS NULL')
      .getCount();
    if (others === 0) throw new Error('refusing: this would leave no other active platform owner');

    const newUser = await loadOrCreateNewUser(em, newEmail, newPhone);
    if (await em.findOne(PlatformAdmin, { where: { user_id: newUser.id } })) {
      throw new Error('the new user is already a platform owner');
    }
    await em.save(em.create(PlatformAdmin, { user_id: newUser.id }));

    await em.update(User, { id: oldUser.id }, { status: UserStatus.SUSPENDED });
    // MFA reset: the same rows `MfaService.reset` removes.
    await em.delete(UserMfa, { user_id: oldUser.id });
    await em.delete(UserRecoveryCode, { user_id: oldUser.id });
    await em.delete(PlatformAdminDevice, { user_id: oldUser.id });
    await em
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where('user_id = :id AND revoked_at IS NULL', { id: oldUser.id })
      .execute();
    await new SessionCutoffService(em.getRepository(User)).cutOff(oldUser.id, em);

    await em.save(
      em.create(AuditLog, {
        tenant_id: null,
        action: AuditAction.PLATFORM_OWNER_REPLACED,
        entity_type: 'PlatformAdmin',
        entity_id: newUser.id,
        performed_by_user_id: null,
        old_values: { user_id: oldUser.id },
        // performed_by is null (CLI): record the OS user who ran it (not PII).
        new_values: { user_id: newUser.id, operator },
      }),
    );
    return { oldUserId: oldUser.id, newUserId: newUser.id };
  });
}

/** Same conflict rules as owner seeding: a deleted or foreign-phone user is refused, never reused. */
async function loadOrCreateNewUser(em: EntityManager, email: string, phone: string): Promise<User> {
  const existing = await em.findOne(User, { where: { email }, withDeleted: true });
  if (existing) {
    if (existing.deleted_at) throw new Error('a deleted user has the new email; restore it first');
    if (existing.status !== UserStatus.ACTIVE) throw new Error('the new user is not active');
    if (existing.phone && existing.phone !== phone) {
      throw new Error('the new user already has a different phone');
    }
    if (!existing.phone) {
      await assertPhoneFree(em, phone);
      existing.phone = phone;
      existing.phone_verified_at = null;
      return em.save(existing);
    }
    return existing;
  }
  await assertPhoneFree(em, phone);
  return em.save(
    em.create(User, {
      email,
      phone,
      full_name: 'Platform Owner',
      // No password: the owner uses "Forgot password" on the cockpit host.
      password_hash: null,
      status: UserStatus.ACTIVE,
    }),
  );
}

async function assertPhoneFree(em: EntityManager, phone: string): Promise<void> {
  if (await em.findOne(User, { where: { phone }, withDeleted: true })) {
    throw new Error('the new phone already belongs to another user');
  }
}

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  return at === -1 ? '' : (process.argv[at + 1] ?? '');
}

if (require.main === module) {
  void (async () => {
    const input = {
      oldEmail: arg('--old-email'),
      newEmail: arg('--new-email'),
      newPhone: arg('--new-phone'),
    };
    const problem = validateReplaceInput(input);
    if (problem) {
      console.error(
        `usage: cockpit-replace-owner --old-email <e> --new-email <e> --new-phone <p>\n${problem}`,
      );
      process.exit(1);
    }
    let code = 1;
    const app = await createScriptAppContext();
    try {
      const { oldUserId, newUserId } = await replaceOwner(app.get(DataSource), input);
      console.log(`replaced owner ${oldUserId} with ${newUserId}`);
      console.log('now ask the new owner to use "Forgot password" on the cockpit host');
      code = 0;
    } catch (err) {
      console.error('cockpit-replace-owner failed:', err instanceof Error ? err.message : 'error');
    } finally {
      await app.close();
    }
    process.exit(code);
  })();
}
