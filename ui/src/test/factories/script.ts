/**
 * Every factory field that's a name, phone or address picks a script per
 * call — Bangla via `./bangla-data.ts`, Latin via faker's own `en` locale —
 * so a large-enough batch of factory calls exercises both, matching the
 * issue's "Bangla and Latin scripts" acceptance criterion. Pass `script`
 * explicitly when a test needs one or the other.
 */
import { bnAddress, bnFullName, bnPhoneNumber, type Gender } from './bangla-data';
import { faker } from './faker';

export type Script = 'bn' | 'latin';

export function pickScript(script?: Script): Script {
  return script ?? faker.helpers.arrayElement<Script>(['bn', 'latin']);
}

export function scriptedFullName(script?: Script, gender?: Gender): string {
  return pickScript(script) === 'bn' ? bnFullName(gender) : faker.person.fullName();
}

export function scriptedPhoneNumber(script?: Script): string {
  return pickScript(script) === 'bn' ? bnPhoneNumber() : faker.phone.number();
}

export function scriptedAddress(script?: Script): string {
  return pickScript(script) === 'bn'
    ? bnAddress()
    : faker.location.streetAddress({ useFullAddress: true });
}
