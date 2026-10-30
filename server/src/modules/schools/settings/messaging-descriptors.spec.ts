// Entry-order cycle guard (B1): loading the schools service FIRST, then the real
// provider list, must not hit a TDZ error. This spec uses the REAL providers and is
// expected red until the providers stop importing SchoolsService (#3298 bridge removal).
import '../schools.service';
import { describe, it, expect } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import type { ProviderDescriptor, TenantSettings } from '@biddaloy/shared';
import { MESSAGING_PROVIDERS } from '../../communications/providers/messaging-providers';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';
import {
  buildMessagingProvidersResponse,
  messagingDescriptors,
  settingsKeyFor,
  soleDescriptorFor,
  whatsappConfigured,
} from './messaging-descriptors';
import { getSecretPaths } from './secret-paths.util';

const filled = (d: ProviderDescriptor) =>
  Object.fromEntries(d.fields.map((f) => [f.key, f.kind === 'secret' ? 'enc:x' : 'v']));
const settingsFor = (d: ProviderDescriptor, values: Record<string, unknown>) =>
  ({
    version: 1,
    communications: { [settingsKeyFor(d.medium)]: { provider: d.name, [d.name]: values } },
  }) as unknown as TenantSettings;
const first = () => messagingDescriptors()[0];

describe('messaging descriptors (real providers)', () => {
  it('reads one descriptor per registered provider', () => {
    const all = messagingDescriptors();
    expect(all).toHaveLength(MESSAGING_PROVIDERS.length);
    for (const d of all) {
      expect(d.name).toBeTruthy();
      expect(d.medium).toBeTruthy();
    }
  });

  it('getSecretPaths contains every provider secret field', () => {
    const paths = getSecretPaths(TenantSettingsDto);
    for (const d of messagingDescriptors()) {
      for (const f of d.fields.filter((x) => x.kind === 'secret')) {
        expect(paths).toContain(`communications.${settingsKeyFor(d.medium)}.${d.name}.${f.key}`);
      }
    }
  });
});

describe('buildMessagingProvidersResponse (real providers)', () => {
  it('empty settings: every medium is not configured', () => {
    const res = buildMessagingProvidersResponse({ version: 1 } as TenantSettings);
    const media = new Set(messagingDescriptors().map((d) => d.medium));
    expect(Object.keys(res).sort()).toEqual([...media].sort());
    for (const m of media) expect(res[m]?.configured).toBe(false);
  });

  it('all required fields present: configured, selected is that provider', () => {
    const d = first();
    const res = buildMessagingProvidersResponse(settingsFor(d, filled(d)));
    expect(res[d.medium]?.configured).toBe(true);
    expect(res[d.medium]?.selected).toBe(d.name);
  });

  it('a required field missing: not configured', () => {
    const d = messagingDescriptors().find((x) => x.fields.some((f) => f.required))!;
    const values = filled(d);
    delete values[d.fields.find((f) => f.required)!.key];
    expect(buildMessagingProvidersResponse(settingsFor(d, values))[d.medium]?.configured).toBe(
      false,
    );
  });

  it('flat block on a sole-provider medium counts as configured', () => {
    const d = Object.values(CommunicationMedium)
      .map((m) => soleDescriptorFor(m))
      .find((x): x is ProviderDescriptor => !!x);
    if (!d) return; // no sole-provider medium registered (after #3300 may be so)
    const settings = {
      version: 1,
      communications: { [settingsKeyFor(d.medium)]: filled(d) },
    } as unknown as TenantSettings;
    expect(buildMessagingProvidersResponse(settings)[d.medium]?.configured).toBe(true);
  });

  it('an unknown stored provider: selected null, not configured', () => {
    const d = first();
    const settings = {
      version: 1,
      communications: { [settingsKeyFor(d.medium)]: { provider: 'no-such-provider' } },
    } as unknown as TenantSettings;
    const res = buildMessagingProvidersResponse(settings)[d.medium];
    expect(res?.selected).toBeNull();
    expect(res?.configured).toBe(false);
  });
});

describe('whatsappConfigured', () => {
  const cfg = (whatsapp: unknown) =>
    ({ version: 1, communications: { whatsapp } }) as unknown as TenantSettings;

  it('true for the pre-D6 flat shape', () => {
    expect(whatsappConfigured(cfg({ phoneNumberId: '1', accessToken: 't' }))).toBe(true);
  });
  it('true for the D6 nested shape', () => {
    expect(
      whatsappConfigured(cfg({ provider: 'meta-cloud', 'meta-cloud': { phoneNumberId: '1' } })),
    ).toBe(true);
  });
  it('false when absent or phoneNumberId blank', () => {
    expect(whatsappConfigured(cfg(undefined))).toBe(false);
    expect(whatsappConfigured(cfg({ 'meta-cloud': { phoneNumberId: '' } }))).toBe(false);
  });
});
