import { CommunicationMedium, CommunicationStatus } from '@beton-boi/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { scriptedFullName, scriptedPhoneNumber, type Script } from './script';

export type Communication = components['schemas']['CommunicationResponseDto'];

export function communicationFactory(
  overrides: Partial<Communication> = {},
  script?: Script,
): Communication {
  const medium = overrides.medium ?? CommunicationMedium.SMS;
  const recipientAddress =
    overrides.recipient_address ??
    (medium === CommunicationMedium.EMAIL ? faker.internet.email() : scriptedPhoneNumber(script));
  return {
    id: faker.string.uuid(),
    medium,
    recipient_address: recipientAddress,
    recipient_name: scriptedFullName(script),
    status: CommunicationStatus.SENT,
    provider_message_id: faker.string.alphanumeric(16),
    created_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    ...overrides,
  };
}
