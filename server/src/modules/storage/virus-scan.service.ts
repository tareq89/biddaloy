import { connect } from 'node:net';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';

const CHUNK_BYTES = 64 * 1024;

export type ScanMode = 'closed' | 'open';

/** Who to put on the audit row when a file is refused. Never a file name or content. */
export interface ScanContext {
  tenantId?: string | null;
  userId?: string | null;
}

/**
 * Streams an upload to ClamAV (clamd INSTREAM over node:net, no dependency).
 *
 * The host is fixed config (CLAMAV_HOST), never user input, so the SSRF guard
 * (Rule 7) does not apply. Messages are fixed sentences: no file name, no
 * signature name, no scanner words (Rules 23, 24; D13). The signature goes to
 * the server log only.
 *
 * `closed`: scanner unreachable refuses the upload (public + family uploads).
 * `open`: scanner unreachable lets it through with a Sentry warning (staff, D19).
 * No CLAMAV_HOST: scan skipped (dev); production refuses to boot without it.
 */
@Injectable()
export class VirusScanService {
  private readonly logger = new Logger(VirusScanService.name);
  /** Whole-scan budget; a field so the spec can shorten it. */
  protected timeoutMs = 10_000;

  constructor(private readonly audit: AuditService) {}

  async assertClean(buffer: Buffer, mode: ScanMode, ctx: ScanContext = {}): Promise<void> {
    const host = process.env.CLAMAV_HOST;
    if (!host) return;

    let reply: string;
    try {
      reply = await this.instream(host, Number(process.env.CLAMAV_PORT) || 3310, buffer);
    } catch (err) {
      this.logger.warn(`virus scan unavailable: ${err instanceof Error ? err.message : err}`);
      if (mode === 'open') {
        Sentry.captureMessage('virus scan unavailable; staff upload allowed', 'warning');
        return;
      }
      throw new ServiceUnavailableException({
        message: "We can't check files right now. Try again shortly.",
        details: { code: 'FILE_CHECK_UNAVAILABLE' },
      });
    }

    if (reply.endsWith('FOUND')) {
      this.logger.warn(`upload refused: ${reply}`);
      // ponytail: AuditAction and AuditEntityType have no upload value (a new one needs a shared
      // enum + DB migration, outside this lane), so this borrows BULK_UPLOAD / ApplicationAttachment and
      // new_values.kind carries the meaning. Swap to `upload.harmful_file` when shared adds it.
      await this.audit.record({
        action: AuditAction.BULK_UPLOAD,
        entity_type: 'ApplicationAttachment',
        new_values: { kind: 'upload.harmful_file' },
        tenant_id: ctx.tenantId ?? null,
        performed_by_user_id: ctx.userId ?? null,
      });
      throw new UnprocessableEntityException({
        message: 'This file looks harmful. Choose another file.',
        details: { code: 'FILE_HARMFUL' },
      });
    }
  }

  private instream(host: string, port: number, buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      let out = '';
      const fail = (e: Error) => {
        socket.destroy();
        reject(e);
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error('timeout')));
      socket.on('error', fail);
      socket.on('data', (d) => (out += d.toString('utf8')));
      socket.on('end', () => {
        const reply = out.replace(/\0/g, '').trim();
        if (reply.endsWith('OK') || reply.endsWith('FOUND')) resolve(reply);
        else fail(new Error('unexpected reply'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < buffer.length; i += CHUNK_BYTES) {
          const chunk = buffer.subarray(i, i + CHUNK_BYTES);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      });
    });
  }
}
