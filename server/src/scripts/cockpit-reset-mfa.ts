import 'reflect-metadata';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
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
 * Resets one platform (cockpit) owner's second factor, audited. [Epic 98 #3755, D15, D18]
 *
 *   node server/dist/scripts/cockpit-reset-mfa.js --email <email>
 *
 * BREAK-GLASS: for an owner who lost the phone AND the recovery codes. It needs
 * shell access to the server and the same trust as the database; there is no
 * HTTP route for it. The password is untouched: the owner signs in with it, then
 * enrols again (email code + SMS code).
 *
 * One transaction: deletes MFA + recovery codes + devices (the rows
 * `MfaService.reset` removes), revokes refresh tokens, cuts sessions (Rule 8),
 * writes `PLATFORM_MFA_RESET` (tenant NULL, user id only, OS operator name).
 * Output carries the user id only, never an email, phone, code or secret.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function resetOwnerMfa(ds: DataSource, emailInput: string): Promise<string> {
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error('--email must be an email address');
  return ds.transaction(async (em) => {
    const user = await em.findOne(User, { where: { email } });
    const owner = user && (await em.findOne(PlatformAdmin, { where: { user_id: user.id } }));
    // Unknown email and a normal user get the same text (Rule 23: no echo, no oracle).
    if (!user || !owner) throw new Error('the email is not a platform owner');

    await em.delete(UserMfa, { user_id: user.id });
    await em.delete(UserRecoveryCode, { user_id: user.id });
    await em.delete(PlatformAdminDevice, { user_id: user.id });
    await em
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where('user_id = :id AND revoked_at IS NULL', { id: user.id })
      .execute();
    await new SessionCutoffService(em.getRepository(User)).cutOff(user.id, em);
    await em.save(
      em.create(AuditLog, {
        tenant_id: null,
        action: AuditAction.PLATFORM_MFA_RESET,
        entity_type: 'PlatformAdmin',
        entity_id: user.id,
        performed_by_user_id: null,
        old_values: null,
        // performed_by is null (CLI): record the OS user who ran it (not PII).
        new_values: { user_id: user.id, operator: os.userInfo().username },
      }),
    );
    return user.id;
  });
}

/** The only success output: a user id and the next step. No email, phone, code or secret. */
export function printResetResult(userId: string): void {
  console.log(`reset second factor for ${userId}`);
  console.log('the owner signs in with the password, then enrols again (email code + SMS code)');
}

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  return at === -1 ? '' : (process.argv[at + 1] ?? '');
}

if (require.main === module) {
  void (async () => {
    const email = arg('--email');
    if (!EMAIL.test(email.trim())) {
      console.error('usage: cockpit-reset-mfa --email <e>\n--email must be an email address');
      process.exit(1);
    }
    let code = 1;
    const app = await createScriptAppContext();
    try {
      printResetResult(await resetOwnerMfa(app.get(DataSource), email));
      code = 0;
    } catch (err) {
      console.error('cockpit-reset-mfa failed:', err instanceof Error ? err.message : 'error');
    }
    await app.close();
    process.exit(code);
  })();
}
