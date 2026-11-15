import { createServer, type Server } from 'node:http';

/**
 * [#3997] A fake bKash tokenized checkout on 127.0.0.1, so the online-payment journey never
 * reaches the real company. The server under test talks to it only through the test seam
 * (`BKASH_TEST_BASE_URL` + `OUTBOUND_TEST_ALLOW_LOOPBACK`, set in playwright.config.ts;
 * 08-security Rule 7). The port is fixed because the server reads the address from its env.
 *
 * `create` remembers the amount and our order id; `execute` answers Completed; `payment/status`
 * answers Cancelled when `cancelNext` was set for that paymentID, else Initiated.
 */
export const BKASH_STUB_PORT = 38417;

export interface BkashStub {
  cancelled: Set<string>;
  close(): Promise<void>;
}

export async function startBkashStub(): Promise<BkashStub> {
  const payments = new Map<string, { amount: string; order: string }>();
  const stub: BkashStub = {
    cancelled: new Set(),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').replace(/^\/v1\.2\.0-beta/, '');
      let body: Record<string, string> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, string>;
      } catch {
        // an empty or odd body is answered below like any unknown call
      }
      const reply = (json: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (path === '/tokenized/checkout/token/grant') return reply({ id_token: 'stub-token' });
      if (path === '/tokenized/checkout/create') {
        const paymentID = `STUB${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        payments.set(paymentID, { amount: body.amount, order: body.merchantInvoiceNumber });
        return reply({
          statusCode: '0000',
          paymentID,
          bkashURL: `https://pay.stub.example/${paymentID}`,
        });
      }
      const known = payments.get(body.paymentID);
      if (!known) return reply({ statusCode: '2062', statusMessage: 'unknown payment' });
      const answer = (transactionStatus: string) => ({
        statusCode: '0000',
        transactionStatus,
        paymentID: body.paymentID,
        trxID: `TRX${body.paymentID.slice(-8)}`,
        amount: known.amount,
        currency: 'BDT',
        merchantInvoiceNumber: known.order,
      });
      if (path === '/tokenized/checkout/execute') return reply(answer('Completed'));
      if (path === '/tokenized/checkout/payment/status') {
        return reply(answer(stub.cancelled.has(body.paymentID) ? 'Cancelled' : 'Initiated'));
      }
      return reply({ statusCode: '9999' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(BKASH_STUB_PORT, '127.0.0.1', resolve);
  });
  return stub;
}
