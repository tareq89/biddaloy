import { CommunicationMedium } from '@biddaloy/shared';
import type {
  MessagingProvidersResponse,
  ProviderDescriptor,
  TenantSettings,
} from '@biddaloy/shared';
import { MESSAGING_PROVIDERS } from '../../communications/providers/messaging-providers';

type HasDescriptor = new () => { readonly descriptor: ProviderDescriptor };
type Block = Record<string, unknown>;

/**
 * Descriptors of every registered messaging provider. The list is read on
 * every call (no module-level cache) so a spec's `vi.mock` of the list
 * module is seen everywhere. `descriptor` is a field initializer, so no
 * constructor argument is ever read (D24, cf. `messaging-providers.spec.ts`).
 */
export function messagingDescriptors(): ProviderDescriptor[] {
  return MESSAGING_PROVIDERS.map((P) => new (P as unknown as HasDescriptor)().descriptor);
}

export const descriptorsFor = (medium: CommunicationMedium): ProviderDescriptor[] =>
  messagingDescriptors().filter((d) => d.medium === medium);

/** D6: the medium's sole provider, whose fields may sit flat under `communications.<medium>` (pre-D6 shape). */
export function soleDescriptorFor(medium: CommunicationMedium): ProviderDescriptor | undefined {
  const all = descriptorsFor(medium);
  return all.length === 1 ? all[0] : undefined;
}

export const settingsKeyFor = (medium: CommunicationMedium): string => medium.toLowerCase();

export const isPlainObject = (v: unknown): v is Block =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Dot-paths of every `kind: 'secret'` field of the medium's providers:
 * `<prefix>.<provider>.<field>`, plus the flat `<prefix>.<field>` (legacy shape).
 */
export function messagingSecretPaths(medium: CommunicationMedium, prefix: string): string[] {
  const paths = new Set<string>();
  for (const d of descriptorsFor(medium)) {
    for (const f of d.fields) if (f.kind === 'secret') paths.add(`${prefix}.${d.name}.${f.key}`);
  }
  // ponytail: flat compat paths cover every provider's secret keys; drop with the D6 compat-removal follow-up.
  for (const d of descriptorsFor(medium)) {
    for (const f of d.fields) if (f.kind === 'secret') paths.add(`${prefix}.${f.key}`);
  }
  return [...paths];
}

/**
 * A flat block (pre-D6, sole provider) is lifted into `<sole.name>`; anything
 * else is returned unchanged. Inputs are never mutated.
 */
export function toNestedMedium(block: unknown, medium: CommunicationMedium): Block | undefined {
  if (!isPlainObject(block)) return undefined;
  const sole = soleDescriptorFor(medium);
  if (!sole || Object.hasOwn(block, sole.name)) return block;
  const moved = sole.fields.map((f) => f.key).filter((k) => Object.hasOwn(block, k));
  if (moved.length === 0) return block;
  const nested: Block = {};
  const inner: Block = {};
  for (const k of Object.keys(block)) {
    if (moved.includes(k)) inner[k] = block[k];
    else nested[k] = block[k];
  }
  nested[sole.name] = inner;
  return nested;
}

const present = (v: unknown): boolean =>
  (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));

/** D32: schema + selected + configured per medium. Presence only; never a value. */
export function buildMessagingProvidersResponse(
  settings: TenantSettings,
): MessagingProvidersResponse {
  const response: MessagingProvidersResponse = {};
  for (const medium of Object.values(CommunicationMedium)) {
    const providers = descriptorsFor(medium);
    if (providers.length === 0) continue;
    const comms = settings.communications as Record<string, unknown> | undefined;
    const block = toNestedMedium(comms?.[settingsKeyFor(medium)], medium);
    const stored = block?.provider;
    // A stray `provider` is ignored when the medium has one provider (same rule as the resolver).
    const selected =
      providers.length === 1
        ? providers[0]
        : (providers.find((d) => d.name === stored) ??
          (stored === undefined ? soleDescriptorFor(medium) : undefined));
    const inner = selected ? block?.[selected.name] : undefined;
    const values = isPlainObject(inner) ? inner : undefined;
    response[medium] = {
      providers,
      selected: selected?.name ?? null,
      configured:
        !!selected &&
        !!values &&
        selected.fields.every((f) => !f.required || present(values[f.key])),
    };
  }
  return response;
}

/**
 * Has this school set up WhatsApp (a phone number id, D6 nested or pre-D6 flat)? Same
 * "tenant opted in" meaning as before; the access token may still come from the platform env.
 */
export function whatsappConfigured(settings: TenantSettings): boolean {
  const comms = settings.communications as Record<string, unknown> | undefined;
  const sole = soleDescriptorFor(CommunicationMedium.WHATSAPP);
  const block = toNestedMedium(
    comms?.[settingsKeyFor(CommunicationMedium.WHATSAPP)],
    CommunicationMedium.WHATSAPP,
  );
  const inner = sole ? block?.[sole.name] : undefined;
  return isPlainObject(inner) && present(inner.phoneNumberId);
}
