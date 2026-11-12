import { SUPPORT_ACCESS_TEXT_VERSION, SupportAccessMode } from '@biddaloy/shared';
import type { School } from '../modules/schools/entities/school.entity';

// Like seed.arrival.ts: must not import anything that reaches AppModule.

/**
 * [99.1.05] Support access already confirmed for a dev-seed school, so no e2e journey is stopped
 * by the first-login page. Only fills an absent confirmation (a hand-set value survives a re-run);
 * returns whether it changed anything.
 */
export function ensureSupportAccessConfirmed(school: School): boolean {
  if (school.settings?.supportAccess?.confirmedAt) return false;
  school.settings = {
    ...(school.settings ?? {}),
    supportAccess: {
      mode: SupportAccessMode.ALLOWED,
      confirmedAt: new Date().toISOString(),
      confirmedBy: null,
      textVersion: SUPPORT_ACCESS_TEXT_VERSION,
    },
  } as School['settings'];
  return true;
}
