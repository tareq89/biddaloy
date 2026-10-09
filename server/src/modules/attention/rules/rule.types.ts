import type {
  AlertRuleMeta,
  AlertSeverity,
  AttentionSettings,
  RuleMessage,
  UserRole,
} from '@biddaloy/shared';

export interface RuleContext {
  tenantId: string;
  now: Date;
  tz: string;
  /** YYYY-MM-DD in the tenant's timezone. */
  localDate: string;
  /** HH:mm in the tenant's timezone. */
  localTime: string;
  isWorkingDay: boolean;
  settings: AttentionSettings;
  actorUserId?: string;
}

/**
 * Reserved `params` keys: `sectionId`, `sectionLabel`, `studentId`, `studentName`.
 * The API (67.1.07) filters and labels items by them, so section/student-scoped
 * rules must set them.
 */
export interface RuleFinding {
  dedupeKey: string;
  subject?: { type: string; id: string };
  params: Record<string, string | number>;
  actionUrl?: string;
  severity?: AlertSeverity;
  escalationLevel?: number;
  expiresAt?: Date;
  recipients: { userId: string; role: UserRole | null; studentId?: string }[];
}

export interface AttentionRule {
  meta: AlertRuleMeta;
  messages: { bn: RuleMessage; en: RuleMessage };
  evaluate(ctx: RuleContext): Promise<RuleFinding[]>;
}

/** D21 escalation step. */
export interface EscalationStep {
  level: number;
  after: { minutes: number } | { schoolDays: number };
  severity: AlertSeverity;
  addRoles: UserRole[];
}

/** Highest step whose threshold is reached, else null. */
export function pickEscalation(
  steps: EscalationStep[],
  elapsed: { minutes: number; schoolDays: number },
): EscalationStep | null {
  let best: EscalationStep | null = null;
  for (const s of steps) {
    const reached =
      'minutes' in s.after
        ? elapsed.minutes >= s.after.minutes
        : elapsed.schoolDays >= s.after.schoolDays;
    if (reached && (!best || s.level > best.level)) best = s;
  }
  return best;
}
