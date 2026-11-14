import type { ActionLineDto } from '@biddaloy/shared';

export interface ActionLineInput {
  /** `sms` null = the balance is unknown. */
  balance: { sms: number | null; stale: boolean };
  promisedUnusedSms: number;
  unsoldSms: number;
  schoolsLow: number;
  expiringSms: number;
}

const ORDER = { danger: 0, warning: 1, neutral: 2 } as const;

/**
 * [100.2.09] Pure: the numbers become at most four ordered lines. Codes and params only; the
 * UI writes the sentence (D12, D15). An unknown or stale balance is a warning, never a danger.
 */
export function buildActionLines(i: ActionLineInput): ActionLineDto[] {
  const lines: ActionLineDto[] = [];
  const stock = { kind: 'tab', tab: 'stock' } as const;
  const { sms } = i.balance;
  if (sms !== null && sms < i.promisedUnusedSms) {
    lines.push({
      code: 'TOP_UP_NOW',
      tone: 'danger',
      params: { balance: sms, promised: i.promisedUnusedSms },
      target: stock,
    });
  } else if (sms === null || i.balance.stale) {
    lines.push({
      code: 'TOP_UP_NOW',
      tone: 'warning',
      params: { balance: sms ?? 'unknown', promised: i.promisedUnusedSms },
      target: stock,
    });
  }
  if (i.unsoldSms < 0)
    lines.push({
      code: 'OVERSOLD',
      tone: 'danger',
      params: { short: -i.unsoldSms },
      target: stock,
    });
  if (i.schoolsLow > 0)
    lines.push({
      code: 'SCHOOLS_LOW',
      tone: 'warning',
      params: { count: i.schoolsLow },
      target: { kind: 'tab', tab: 'schools' },
    });
  if (i.expiringSms > 0)
    lines.push({
      code: 'SMS_EXPIRING',
      tone: 'warning',
      params: { sms: i.expiringSms, days: 7 },
      target: { kind: 'tab', tab: 'schools' },
    });
  return lines.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]).slice(0, 4);
}
