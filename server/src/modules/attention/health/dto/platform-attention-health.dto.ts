/** Per-cadence values for `GET /platform/attention/health`. */
export class AttentionCadenceStringsDto {
  FAST: string | null;
  HOURLY: string | null;
  DAILY: string | null;
}

export class AttentionCadenceNumbersDto {
  FAST: number | null;
  HOURLY: number | null;
  DAILY: number | null;
}

export class FailingRuleDto {
  key: string;
  lastError: string;
  count: number;
}

/** Global engine data only — no tenant rows. */
export class PlatformAttentionHealthDto {
  lastSweep: AttentionCadenceStringsDto;
  durationsMs: AttentionCadenceNumbersDto;
  failingRules: FailingRuleDto[];
}
