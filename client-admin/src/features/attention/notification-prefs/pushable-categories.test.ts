import { ALERT_RULES, AlertCategory, AlertSeverity, UserRole } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { pushableCategoriesFor } from './pushable-categories';

describe('pushableCategoriesFor', () => {
  it('lists the categories a role can mute', () => {
    expect(pushableCategoriesFor(UserRole.TEACHER)).toEqual(
      expect.arrayContaining([
        AlertCategory.ATTENDANCE,
        AlertCategory.HOMEWORK,
        AlertCategory.PERIOD,
        AlertCategory.MANUAL,
      ]),
    );
    expect(pushableCategoriesFor(UserRole.PARENT)).toEqual(
      expect.arrayContaining([AlertCategory.FAMILY, AlertCategory.HOMEWORK]),
    );
    expect(pushableCategoriesFor(UserRole.SUPER_ADMIN)).toContain(AlertCategory.PLATFORM);
  });

  it('never lists a category whose pushable rules are all CRITICAL', () => {
    for (const role of Object.values(UserRole)) {
      for (const category of pushableCategoriesFor(role)) {
        if (category === AlertCategory.MANUAL) continue;
        const mutable = ALERT_RULES.some(
          (r) =>
            r.category === category &&
            r.pushable &&
            r.severity !== AlertSeverity.CRITICAL &&
            (r.roles.length === 0 || r.roles.includes(role)),
        );
        expect(mutable, `${role}/${category}`).toBe(true);
      }
    }
  });
});
