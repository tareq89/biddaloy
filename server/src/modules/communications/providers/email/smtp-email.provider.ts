import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  assertSafeSmtpDestination,
  DestinationBlockedError,
  OutboundDestinationError,
  SafeSmtpDestination,
} from '../shared/outbound-destination-guard';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';
import {
  ResolvedEmailConfig,
  TenantProviderConfigResolver,
} from '../../config/tenant-provider-config.resolver';

function mapSmtpError(err: unknown): string {
  if (err instanceof OutboundDestinationError) {
    return err.message;
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EAUTH') {
    return 'Authentication rejected — check the SMTP username and password.';
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'EDNS') {
    return 'Could not reach the SMTP server — check the host and port.';
  }
  return 'Connection test failed — could not verify the credentials.';
}

const SMTP_CONNECTION_ERROR_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNREFUSED',
]);

function isSmtpConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && SMTP_CONNECTION_ERROR_CODES.has(code);
}

/**
 * Tries each of `destination.addresses` in order — pinning to a single
 * literal IP (instead of the original hostname) short-circuits
 * nodemailer's own DNS resolution, which otherwise gives it built-in
 * failover across multiple A/AAAA records; this restores that resilience
 * without a second DNS lookup. `buildTransport` gets a fresh transporter
 * per attempt (nodemailer transporters aren't safe to reuse across hosts).
 * Only a connection-class failure (that address wasn't reachable at all)
 * advances to the next one — an auth failure, a rejected message, or any
 * error nodemailer hasn't tagged as connection-level is assumed to mean
 * the address answered and something else went wrong, so it's surfaced
 * immediately rather than risking the message being sent twice.
 */
async function withPinnedAddressFallback<T>(
  destination: SafeSmtpDestination,
  buildTransport: (host: string) => nodemailer.Transporter,
  action: (transporter: nodemailer.Transporter) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const { address } of destination.addresses) {
    try {
      return await action(buildTransport(address));
    } catch (err) {
      lastError = err;
      if (!isSmtpConnectionError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * Plain SMTP email — works against any SMTP endpoint (self-hosted,
 * SendGrid's SMTP relay, etc.), no vendor-specific SDK.
 *
 * The transporter is built fresh per send from that tenant's resolved
 * config rather than cached on the instance — a single cached transporter
 * would silently reuse the first tenant's SMTP credentials for every
 * tenant after it (#8.7.10).
 */
@Injectable()
export class SmtpEmailProvider implements CommunicationProvider {
  constructor(private readonly configResolver: TenantProviderConfigResolver) {}

  async send(params: CommunicationSendParams, tenantId: string): Promise<CommunicationSendResult> {
    try {
      const { host, port, user, password, from } = await this.configResolver.resolveEmail(tenantId);
      const destination = await assertSafeSmtpDestination(host, port);
      const info = await withPinnedAddressFallback(
        destination,
        (pinnedHost) =>
          nodemailer.createTransport({
            host: pinnedHost,
            port,
            secure: port === 465,
            auth: { user, pass: password },
            ...(destination.servername ? { tls: { servername: destination.servername } } : {}),
          }),
        (transporter) =>
          transporter.sendMail({
            from,
            to: params.to,
            subject: params.subject ?? '',
            text: params.body,
          }),
      );
      return {
        success: true,
        providerMessageId: info.messageId ?? null,
        raw: { response: info.response },
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
        // A resolved-to-a-blocked-destination or unconfigured-provider
        // failure is permanent; a DNS hiccup (DestinationResolutionError)
        // or transport-level error may succeed on retry.
        retryable:
          err instanceof ProviderNotConfiguredError || err instanceof DestinationBlockedError
            ? false
            : undefined,
      };
    }
  }

  /**
   * #8.7.12's connection test — `transporter.verify()` is nodemailer's own
   * cheapest check: it opens the connection and authenticates without
   * sending a message. `config` can be an unsaved draft or the tenant's
   * stored config; this method doesn't care which.
   */
  async testConnection(config: ResolvedEmailConfig): Promise<ConnectionTestResult> {
    try {
      const destination = await assertSafeSmtpDestination(config.host, config.port);
      await withPinnedAddressFallback(
        destination,
        (pinnedHost) =>
          nodemailer.createTransport({
            host: pinnedHost,
            port: config.port,
            secure: config.port === 465,
            auth: { user: config.user, pass: config.password },
            ...(destination.servername ? { tls: { servername: destination.servername } } : {}),
          }),
        (transporter) => transporter.verify(),
      );
      return { success: true, message: 'Connected — SMTP credentials verified.' };
    } catch (err) {
      return { success: false, message: mapSmtpError(err) };
    }
  }
}
