export const SMS_SOURCES = ['OWN', 'SCHOOLMANAGERP'] as const;
export type SmsSource = (typeof SMS_SOURCES)[number];

type Settings = Record<string, unknown> | null | undefined;

const smsBlock = (settings: Settings): Record<string, unknown> => {
  const comms = settings?.communications as { sms?: unknown } | undefined;
  const sms = comms?.sms;
  return sms && typeof sms === 'object' && !Array.isArray(sms)
    ? (sms as Record<string, unknown>)
    : {};
};

/**
 * Who provides this school's SMS (Epic 100, D9). An explicit stored `source` wins; absent or
 * garbage reads as derived from `metering` (PLATFORM = SchoolManagerP), so no data migration.
 */
export function readSmsSource(settings: Settings): SmsSource {
  const sms = smsBlock(settings);
  if (sms.source === 'OWN' || sms.source === 'SCHOOLMANAGERP') return sms.source;
  return sms.metering === 'PLATFORM' ? 'SCHOOLMANAGERP' : 'OWN';
}

/**
 * Copy of `settings` with `source` and `metering` set together. Every company block is left
 * as it is, so switching back to OWN restores the own provider.
 */
export function withSmsSource(settings: Settings, next: SmsSource): Record<string, unknown> {
  const comms = (settings?.communications ?? {}) as Record<string, unknown>;
  return {
    ...(settings ?? {}),
    communications: {
      ...comms,
      sms: {
        ...smsBlock(settings),
        source: next,
        metering: next === 'SCHOOLMANAGERP' ? 'PLATFORM' : 'OFF',
      },
    },
  };
}
