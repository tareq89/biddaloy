import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * [#3304] A fake OneCodeSoft v3 API on 127.0.0.1 so the settings journeys never reach a real
 * company. The server under test accepts this address only through the test seam
 * `OUTBOUND_TEST_ALLOW_LOOPBACK` (playwright.config.ts; 08-security Rule 7).
 * Paths are served under the `/api` base a school types as its API address.
 */
export const VENDOR_STUB_PORT = 4010;
export const VENDOR_STUB_URL = `http://127.0.0.1:${VENDOR_STUB_PORT}/api`;

export interface StubRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

export interface VendorStub {
  requests: StubRequest[];
  /** Answer every request with this HTTP status (401 or 500) until set back to null. */
  failWith: 401 | 500 | null;
  close(): Promise<void>;
}

export async function startVendorStub(): Promise<VendorStub> {
  let statusCalls = 0;
  const stub: VendorStub = {
    requests: [],
    failWith: null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', VENDOR_STUB_URL);
    const path = url.pathname.replace(/^\/api/, '');
    stub.requests.push({
      method: req.method ?? 'GET',
      path,
      authorization: req.headers.authorization,
    });
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    req.resume();
    if (stub.failWith === 401) return reply(401, { message: 'Unauthenticated.' });
    if (stub.failWith === 500) return reply(500, { message: 'vendor secret failure text' });
    if (path === '/v3/balance') {
      return reply(200, { status: 'success', data: { balance: 120.5, estimate_sms: 400 } });
    }
    if (path === '/v3/send-sms' && req.method === 'POST') {
      return reply(200, {
        status: 'success',
        data: { results: [{ status: 'sent', message_id: 'stub-msg-1', sms_count: 1 }] },
      });
    }
    if (path === '/v3/status') {
      statusCalls += 1;
      const delivered = statusCalls >= 2;
      return reply(200, {
        status: 'success',
        data: { Data: { Status: delivered ? 'Delivered' : 'Pending', ErrorCode: '000' } },
      });
    }
    return reply(404, { status: 'error', message: 'not found' });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(VENDOR_STUB_PORT, '127.0.0.1', resolve);
  });
  return stub;
}
