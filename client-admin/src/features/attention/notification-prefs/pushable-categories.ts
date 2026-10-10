import { ALERT_RULES, AlertCategory, AlertSeverity, type UserRole } from '@biddaloy/shared';

/**
 * [67.5.08] The alert categories a role can mute: those with at least one pushable,
 * non-CRITICAL rule for the role (CRITICAL always pushes, so a category made only of
 * those has nothing to mute), plus MANUAL. In catalogue order.
 */
export function pushableCategoriesFor(role: UserRole): AlertCategory[] {
  const categories = new Set<AlertCategory>();
  for (const rule of ALERT_RULES) {
    if (
      rule.pushable &&
      rule.severity !== AlertSeverity.CRITICAL &&
      (rule.roles.length === 0 || rule.roles.includes(role))
    ) {
      categories.add(rule.category);
    }
  }
  categories.add(AlertCategory.MANUAL);
  return [...categories];
}
