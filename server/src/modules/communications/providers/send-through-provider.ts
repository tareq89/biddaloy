import { CommunicationMedium, countSmsSegments } from '@biddaloy/shared';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';
import type { MessagingProvider } from './messaging-provider';
import type {
  CommunicationSendParams,
  CommunicationSendResult,
} from './communication-provider.interface';

// An SMS log always carries its segment count (#549/#570), even when the send failed early.
const segmentsFor = (medium: CommunicationMedium, params: CommunicationSendParams) =>
  medium === CommunicationMedium.SMS ? countSmsSegments(params.body).segments : undefined;

/** A failure before any provider call (config resolution). Missing config never reached the network. */
export function failedResult(
  err: unknown,
  medium: CommunicationMedium,
  params: CommunicationSendParams,
): CommunicationSendResult {
  const rejected = err instanceof ProviderNotConfiguredError;
  return {
    success: false,
    providerMessageId: null,
    error: err instanceof Error ? err.message : String(err),
    segments: segmentsFor(medium, params),
    retryable: rejected ? false : undefined,
    outcome: rejected ? 'REJECTED' : 'AMBIGUOUS',
  };
}

/** Providers must not throw; if one does, whether it reached the network is unknown, so AMBIGUOUS. */
export async function sendThroughProvider<TConfig>(
  provider: MessagingProvider<TConfig>,
  params: CommunicationSendParams,
  config: TConfig,
): Promise<CommunicationSendResult> {
  const medium = provider.descriptor.medium;
  try {
    const result = await provider.send(params, config);
    const segments = segmentsFor(medium, params);
    return segments !== undefined && result.segments === undefined
      ? { ...result, segments }
      : result;
  } catch (err) {
    return {
      success: false,
      providerMessageId: null,
      error: err instanceof Error ? err.message : String(err),
      segments: segmentsFor(medium, params),
      outcome: 'AMBIGUOUS',
    };
  }
}
