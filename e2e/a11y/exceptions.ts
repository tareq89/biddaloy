/**
 * [8.5.5] Suppression protocol — the only sanctioned way to disable an
 * axe rule. Time-boxed: once `recheckIso` passes, the suite throws, so
 * an exception cannot quietly become permanent.
 *
 * Usage (the reason string is mandatory documentation, not decoration):
 *
 *   AxeBuilder.disableRules([
 *     a11yException('color-contrast', 'tracked in #999, palette rework', '2026-10-01'),
 *   ])
 */
export function a11yException(ruleId: string, reason: string, recheckIso: string): string {
  if (Number.isNaN(Date.parse(recheckIso))) {
    throw new Error(`a11yException(${ruleId}): invalid recheck date "${recheckIso}"`);
  }
  if (Date.now() > Date.parse(recheckIso)) {
    throw new Error(
      `a11y exception for "${ruleId}" expired on ${recheckIso} — ${reason}. ` +
        'Fix the violation or consciously extend the date.',
    );
  }
  if (!reason.trim()) {
    throw new Error(`a11yException(${ruleId}): a reason is required`);
  }
  return ruleId;
}
