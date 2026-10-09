import type { Repository } from 'typeorm';
import {
  AlertCategory,
  AlertRecipientState,
  AlertSeverity,
  AlertSource,
  AlertStatus,
  UserRole,
} from '@biddaloy/shared';
import type { Alert } from '../modules/attention/entities/alert.entity';
import type { AlertRecipient } from '../modules/attention/entities/alert-recipient.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import type { User } from '../modules/users/entities/user.entity';
import { ASSISTANT_TEACHER_EMAIL, ROLE_TEST_USERS } from './seed.util';

// Like seed.evaluations.ts: must not import anything that reaches AppModule.

export interface AttentionSeedRepositories {
  userRepository: Repository<User>;
  userTenantRepository: Repository<UserTenant>;
  alertRepository: Repository<Alert>;
  alertRecipientRepository: Repository<AlertRecipient>;
}

const DEMO = [
  { n: 1, severity: AlertSeverity.WARNING, title: 'ডেমো: আজকের করণীয় দেখুন' },
  { n: 2, severity: AlertSeverity.REMINDER, title: 'ডেমো: সাপ্তাহিক অনুস্মারক' },
] as const;

/** Two MANUAL demo alerts (one WARNING, one REMINDER) per role user of the tenant. */
export async function ensureAttentionSeed(
  repos: AttentionSeedRepositories,
  tenantId: string,
): Promise<void> {
  for (const { email, role } of ROLE_TEST_USERS) {
    if (role === UserRole.SUPER_ADMIN || email === ASSISTANT_TEACHER_EMAIL) continue;
    const user = await repos.userRepository.findOne({ where: { email } });
    const membership = user
      ? await repos.userTenantRepository.findOne({
          where: { user_id: user.id, tenant_id: tenantId, role },
        })
      : null;
    if (!user || !membership) {
      console.warn(`  Attention seed: skipping ${role} (${email}) - no membership in tenant`);
      continue;
    }
    const isFamily = role === UserRole.PARENT || role === UserRole.STUDENT;
    for (const { n, severity, title } of DEMO) {
      const where = {
        tenant_id: tenantId,
        rule_key: 'manual.alert',
        dedupe_key: `seed:${role}:${n}`,
        status: AlertStatus.ACTIVE,
      };
      const alert =
        (await repos.alertRepository.findOne({ where })) ??
        (await repos.alertRepository.save(
          repos.alertRepository.create({
            ...where,
            source: AlertSource.MANUAL,
            severity,
            category: AlertCategory.MANUAL,
            params: {},
            action_url: isFamily ? '/portal' : '/notifications',
            raised_at: new Date(),
            expires_at: null,
            created_by_user_id: null,
            manual_title: title,
            manual_body: 'এটি একটি ডেমো বিজ্ঞপ্তি। আসল সতর্কতা শুরু হলে এখানে দেখা যাবে।',
          }),
        ));
      const key = { alert_id: alert.id, user_id: user.id };
      if (!(await repos.alertRecipientRepository.findOne({ where: key }))) {
        await repos.alertRecipientRepository.save(
          repos.alertRecipientRepository.create({
            ...key,
            tenant_id: tenantId,
            role,
            state: AlertRecipientState.OPEN,
            student_id: null,
          }),
        );
      }
    }
  }
  console.log('  Attention demo alerts ensured');
}
