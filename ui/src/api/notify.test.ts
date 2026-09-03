import { afterEach, describe, expect, it } from 'vitest';

import { setActiveTenant } from './auth-state';
import { clearNotifications, getNotifications } from './notification-state';
import { captureNotificationTenant, notifyOutcome, notifyOutcomeFromCommon } from './notify';

describe('notify', () => {
  afterEach(() => {
    clearNotifications();
    setActiveTenant(null);
  });

  it('captureNotificationTenant reads the active tenant', () => {
    setActiveTenant('school-a');
    expect(captureNotificationTenant()).toBe('school-a');
  });

  it('notifyOutcome forwards the record to the store', () => {
    setActiveTenant('school-a');
    notifyOutcome({ tenantId: 'school-a', variant: 'success', message: 'Payment recorded' });

    expect(getNotifications()).toHaveLength(1);
    expect(getNotifications()[0]?.message).toBe('Payment recorded');
    expect(getNotifications()[0]?.variant).toBe('success');
  });

  it('drops the record when the tenant changed between capture and push', () => {
    setActiveTenant('school-a');
    const tenantId = captureNotificationTenant();
    setActiveTenant('school-b');
    notifyOutcome({ tenantId, variant: 'success', message: 'Payment recorded' });

    expect(getNotifications()).toHaveLength(0);
  });

  it('notifyOutcomeFromCommon resolves a common-namespace key synchronously', () => {
    setActiveTenant('school-a');
    notifyOutcomeFromCommon({
      tenantId: 'school-a',
      variant: 'error',
      key: 'notifications.syncConflict',
    });

    expect(getNotifications()[0]?.message).not.toBe('notifications.syncConflict');
    expect(getNotifications()[0]?.variant).toBe('error');
  });
});
