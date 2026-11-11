import { describe, expect, it } from 'vitest';

import { isCockpitHost } from './cockpit-host';

describe('isCockpitHost', () => {
  it.each([
    'cockpit.schoolmanagerp.com',
    'cockpit-staging.schoolmanagerp.com',
    'cockpit.localhost',
  ])('matches %s', (host) => expect(isCockpitHost(host)).toBe(true));
  it.each(['app.schoolmanagerp.com', 'mycockpit.example.com', 'cockpit', 'localhost'])(
    'does not match %s',
    (host) => expect(isCockpitHost(host)).toBe(false),
  );
});
