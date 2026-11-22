import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface FakeClamdOptions {
  /** Accept the connection and never answer. */
  hang?: boolean;
  /** Answer with bytes that are not a clamd reply. */
  garbage?: boolean;
}

/** A tiny clamd that speaks INSTREAM: `FOUND` when the body holds EICAR, `OK` otherwise. */
export async function startFakeClamd(
  opts: FakeClamdOptions = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (opts.hang) return;
    let buf: Buffer = Buffer.alloc(0);
    socket.on('error', () => undefined);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const head = 'zINSTREAM\0'.length;
      if (buf.length < head) return;
      let off = head;
      const body: Buffer[] = [];
      while (buf.length >= off + 4) {
        const len = buf.readUInt32BE(off);
        if (len === 0) {
          const text = Buffer.concat(body).toString('latin1');
          socket.end(
            opts.garbage
              ? 'what is this\0'
              : text.includes(EICAR)
                ? 'stream: Eicar-Test-Signature FOUND\0'
                : 'stream: OK\0',
          );
          return;
        }
        if (buf.length < off + 4 + len) return;
        body.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        sockets.forEach((s) => s.destroy());
      }),
  };
}
