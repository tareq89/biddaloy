import { createServer, AddressInfo, Server } from 'net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { MailpitSinkProvider } from './mailpit-sink.provider';

/**
 * Stand-in for Mailpit (no docker in test-env): a tiny SMTP listener that records the DATA of each
 * message. Proves the real provider + real nodemailer put an OTP-shaped, tagged mail on the wire.
 */
describe('MailpitSinkProvider over a real SMTP socket', () => {
  let server: Server;
  let received: string[];
  let closed: boolean;

  const closeServer = () =>
    new Promise<void>((r) => {
      if (closed) return r();
      closed = true;
      server.close(() => r());
    });

  beforeEach(async () => {
    received = [];
    closed = false;
    server = createServer((sock) => {
      let inData = false;
      let buf = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString();
        if (inData) {
          if (buf.endsWith('\r\n.\r\n')) {
            received.push(buf);
            buf = '';
            inData = false;
            sock.write('250 OK queued\r\n');
          }
          return;
        }
        for (const line of buf.split('\r\n').filter(Boolean)) {
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250 test\r\n');
          else if (cmd === 'DATA') {
            inData = true;
            sock.write('354 go\r\n');
          } else if (cmd === 'QUIT') sock.end('221 bye\r\n');
          else sock.write('250 OK\r\n');
        }
        buf = '';
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    vi.stubEnv(
      'MESSAGE_SINK_SMTP_URL',
      `smtp://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
  });

  it('delivers an OTP-shaped email, tagged EMAIL, to the listener', async () => {
    const result = await MailpitSinkProvider.forMedium(CommunicationMedium.EMAIL).send({
      to: 'parent@example.com',
      subject: 'Your login code',
      body: 'Your code is 123456',
    });
    expect(result).toMatchObject({ success: true, outcome: 'ACCEPTED' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatch(/X-Tags: EMAIL/i);
    expect(received[0]).toMatch(/To: parent@example\.com/i);
    expect(received[0]).toMatch(/Subject: Your login code/i);
    expect(received[0]).toContain('Your code is 123456');
  });

  it('SMS OTP lands as a sink address tagged SMS', async () => {
    await MailpitSinkProvider.forMedium(CommunicationMedium.SMS).send({
      to: '01711111111',
      body: 'Code 654321',
    });
    expect(received[0]).toMatch(/X-Tags: SMS/i);
    expect(received[0]).toMatch(/To: 01711111111@sms\.sink\.invalid/i);
    expect(received[0]).toContain('Code 654321');
  });

  it('inbox down gives REJECTED (the FAILED log row, D10)', async () => {
    await closeServer();
    const result = await MailpitSinkProvider.forMedium(CommunicationMedium.EMAIL).send({
      to: 'a@b.c',
      body: 'x',
    });
    expect(result).toMatchObject({ success: false, outcome: 'REJECTED' });
  });
});
