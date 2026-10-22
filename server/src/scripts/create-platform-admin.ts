import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { User } from '../modules/users/entities/user.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { School } from '../modules/schools/entities/school.entity';
import { hashPassword } from '../modules/auth/password-hash';
import { redactPii } from '../common/redact-log.util';

/**
 * `ADMIN_PASSWORD=... node server/dist/scripts/create-platform-admin.js <email> "<full name>"`
 *
 * Makes a SUPER_ADMIN of the platform school (`PLATFORM_TENANT_ID`) on a fresh prod database,
 * where no one can log in yet (guide 31-vps-deploy-walkthrough step 11). The password is read
 * from ADMIN_PASSWORD, never argv, so it is not in the process list or shell history.
 *
 * Safe to re-run: an existing user keeps its password; only a missing membership is added.
 * Exit codes: 0 done, 1 error. Output names the email and the outcome, never the password.
 */
export type AdminOutcome = 'created' | 'membership-added' | 'already-admin';

export interface PlatformAdminInput {
  tenantId: string;
  email: string;
  fullName: string;
  password: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Input checks, before anything touches the database. Returns the first problem, or null. */
export function validateInput(input: PlatformAdminInput): string | null {
  if (!UUID.test(input.tenantId)) return 'PLATFORM_TENANT_ID must be the platform school uuid';
  if (!EMAIL.test(input.email)) return 'usage: create-platform-admin <email> "<full name>"';
  if (!input.fullName.trim()) return 'usage: create-platform-admin <email> "<full name>"';
  // bcrypt reads only the first 72 bytes (Rule 9).
  const bytes = Buffer.byteLength(input.password, 'utf8');
  if (bytes < 12 || bytes > 72) return 'ADMIN_PASSWORD must be 12 to 72 bytes';
  return null;
}

export async function ensurePlatformAdmin(
  ds: DataSource,
  input: PlatformAdminInput,
): Promise<AdminOutcome> {
  const email = input.email.trim().toLowerCase();
  return ds.transaction(async (em) => {
    const school = await em.findOne(School, { where: { id: input.tenantId } });
    if (!school) throw new Error('PLATFORM_TENANT_ID does not match any school');

    let user = await em.findOne(User, { where: { email }, withDeleted: true });
    let outcome: AdminOutcome = 'already-admin';
    if (!user) {
      user = await em.save(
        em.create(User, {
          email,
          full_name: input.fullName.trim(),
          password_hash: await hashPassword(input.password),
          status: UserStatus.ACTIVE,
          // The owner types their own address here; there is no inbox flow before the first login.
          email_verified_at: new Date(),
        }),
      );
      outcome = 'created';
    } else if (user.deleted_at) {
      throw new Error('a deleted user has this email; restore or rename it first');
    }

    // One row per (user, school, role): add the SUPER_ADMIN row, never rewrite another role.
    const membership = await em.findOne(UserTenant, {
      where: { user_id: user.id, tenant_id: school.id, role: UserRole.SUPER_ADMIN },
    });
    if (!membership) {
      await em.save(
        em.create(UserTenant, {
          user_id: user.id,
          tenant_id: school.id,
          role: UserRole.SUPER_ADMIN,
        }),
      );
      if (outcome !== 'created') outcome = 'membership-added';
    }
    return outcome;
  });
}

if (require.main === module) {
  void (async () => {
    const input: PlatformAdminInput = {
      tenantId: (process.env.PLATFORM_TENANT_ID ?? '').trim(),
      email: process.argv[2] ?? '',
      fullName: process.argv[3] ?? '',
      password: process.env.ADMIN_PASSWORD ?? '',
    };
    const problem = validateInput(input);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
    let ds: DataSource | undefined;
    let code = 1;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ds = require('../data-source').default as DataSource;
      await ds.initialize();
      const outcome = await ensurePlatformAdmin(ds, input);
      console.log(`${input.email.trim().toLowerCase()}: ${outcome}`);
      code = 0;
    } catch (err) {
      console.error(
        'create-platform-admin failed:',
        redactPii(err instanceof Error ? err.message : String(err)),
      );
    } finally {
      if (ds?.isInitialized) await ds.destroy();
    }
    process.exit(code);
  })();
}
