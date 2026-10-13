import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import {
  Controller,
  Headers,
  HttpCode,
  INestApplication,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { configureBodyParser } from '../../body-parser';
import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature.util';

const SECRET = 'whsec_test';

// Lives only in this spec: the kit adds no route to AppModule.
@Controller('test-webhook')
class TestWebhookController {
  @Post()
  @HttpCode(200)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature = '',
    @Headers('x-timestamp') timestamp = '',
  ) {
    const ok =
      !!req.rawBody &&
      verifyWebhookSignature({ rawBody: req.rawBody, signature, timestamp, secret: SECRET });
    if (!ok) throw new UnauthorizedException();
    return { ok: true };
  }
}

// Spacing and key order that JSON.stringify(parsedBody) would change, so a pass
// proves the raw bytes were signed-over, not a re-serialisation.
const RAW = '{"b":1,  "a":2}';

describe('inbound webhook verification (real body-parser setup)', () => {
  let app: INestApplication;
  const now = () => String(Math.floor(Date.now() / 1000));
  const post = (body: string, headers: Record<string, string>) =>
    supertest(app.getHttpServer())
      .post('/test-webhook')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
  const signed = (body = RAW, ts = now(), secret = SECRET) => ({
    'x-timestamp': ts,
    'x-signature': signWebhookPayload(Buffer.from(body), ts, secret),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestWebhookController],
    }).compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureBodyParser(nest);
    await nest.init();
    app = nest;
  });
  afterAll(() => app.close());

  it('a correctly signed raw body is accepted', async () => {
    await post(RAW, signed()).expect(200);
  });

  it('a tampered body gets 401', async () => {
    await post('{"b":1,  "a":3}', signed()).expect(401);
  });

  it('a wrong secret gets 401', async () => {
    await post(RAW, signed(RAW, now(), 'other')).expect(401);
  });

  it('a timestamp 301 s old gets 401', async () => {
    await post(RAW, signed(RAW, String(Number(now()) - 301))).expect(401);
  });

  it('a timestamp 301 s in the future gets 401', async () => {
    await post(RAW, signed(RAW, String(Number(now()) + 301))).expect(401);
  });

  it('a missing signature header gets 401', async () => {
    await post(RAW, { 'x-timestamp': now() }).expect(401);
  });

  it('a 2 MB body gets 413: rawBody did not lift the 1 MB limit', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
    await post(big, signed(big)).expect(413);
  });
});
