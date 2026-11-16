import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { EICAR, startFakeClamd } from '../../../test/helpers/fake-clamd';
import type { AuditService } from '../audit/audit.service';
import { VirusScanService } from './virus-scan.service';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

describe('VirusScanService', () => {
  const record = vi.fn().mockResolvedValue(undefined);
  let svc: VirusScanService;
  let fake: Awaited<ReturnType<typeof startFakeClamd>> | undefined;

  const use = async (opts = {}) => {
    fake = await startFakeClamd(opts);
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(fake.port);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new VirusScanService({ record } as unknown as AuditService);
    (svc as unknown as { timeoutMs: number }).timeoutMs = 300;
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
  });

  it('resolves for a clean buffer', async () => {
    await use();
    await expect(svc.assertClean(Buffer.from('hello'), 'closed')).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses EICAR with 422 FILE_HARMFUL and one audit row without file data', async () => {
    await use();
    const err = await svc
      .assertClean(Buffer.from(EICAR, 'latin1'), 'closed', { tenantId: 't1', userId: 'u1' })
      .catch((e) => e);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toEqual({
      message: 'This file looks harmful. Choose another file.',
      details: { code: 'FILE_HARMFUL' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ tenant_id: 't1', performed_by_user_id: 'u1' });
    expect(JSON.stringify(err.getResponse())).not.toMatch(/Eicar|ClamAV|malware|infected/i);
  });

  it('fake down + closed: 503 FILE_CHECK_UNAVAILABLE', async () => {
    await use();
    await fake!.close();
    const err = await svc.assertClean(Buffer.from('x'), 'closed').catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({
      message: "We can't check files right now. Try again shortly.",
      details: { code: 'FILE_CHECK_UNAVAILABLE' },
    });
  });

  it('fake down + open: resolves and warns Sentry', async () => {
    await use();
    await fake!.close();
    await expect(svc.assertClean(Buffer.from('x'), 'open')).resolves.toBeUndefined();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'virus scan unavailable; staff upload allowed',
      'warning',
    );
  });

  it('a scanner that never answers times out (closed -> 503, open -> resolves)', async () => {
    await use({ hang: true });
    await expect(svc.assertClean(Buffer.from('x'), 'closed')).rejects.toMatchObject({
      status: 503,
    });
    await expect(svc.assertClean(Buffer.from('x'), 'open')).resolves.toBeUndefined();
  });

  it('a garbage reply is treated as unavailable', async () => {
    await use({ garbage: true });
    await expect(svc.assertClean(Buffer.from('x'), 'closed')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('streams a 5 MB buffer in chunks and still sees EICAR at the end', async () => {
    await use();
    const big = Buffer.concat([Buffer.alloc(5 * 1024 * 1024, 1), Buffer.from(EICAR, 'latin1')]);
    await expect(svc.assertClean(big, 'closed')).rejects.toMatchObject({ status: 422 });
    await expect(
      svc.assertClean(Buffer.alloc(5 * 1024 * 1024, 1), 'closed'),
    ).resolves.toBeUndefined();
  });

  it('no CLAMAV_HOST: resolves without connecting', async () => {
    await expect(svc.assertClean(Buffer.from(EICAR), 'closed')).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });
});
