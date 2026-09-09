import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { buildPinoOptions } from './pino-options';

describe('buildPinoOptions', () => {
  it('redacts PII from the serialized request URL in production', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { method: 'GET', url: '/api/v1/students?phone=01711111111' } as any;

    const serialized = options?.serializers?.req?.(fakeReq);

    expect(serialized.url).not.toContain('01711111111');
    expect(serialized.url).toContain('[REDACTED_PHONE]');
  });

  it('keeps only statusCode on the serialized response', () => {
    const options = buildPinoOptions('production');
    const fakeRes = { statusCode: 200, headers: { 'x-secret': 'nope' } } as any;

    expect(options?.serializers?.res?.(fakeRes)).toEqual({ statusCode: 200 });
  });

  it('uses error_class and a redacted message, and drops the stack in production', () => {
    const options = buildPinoOptions('production');
    const err = new Error('failed for guardian@example.com');

    const serialized = options?.serializers?.err?.(err) as any;

    expect(serialized.error_class).toBe('Error');
    expect(serialized.message).toContain('[REDACTED_EMAIL]');
    expect(serialized.stack).toBeUndefined();
  });

  it('keeps the stack outside production', () => {
    const options = buildPinoOptions('development');
    const err = new Error('boom');

    const serialized = options?.serializers?.err?.(err) as any;

    expect(serialized.stack).toBe(err.stack);
  });

  it('produces a valid JSON log line in production with the six required fields', () => {
    const options = buildPinoOptions('production');
    const lines: string[] = [];
    const writableStream = {
      write: (chunk: string) => {
        lines.push(chunk);
        return true;
      },
    };
    const logger = pino({ ...options, transport: undefined }, writableStream as any);

    logger.info(
      {
        request_id: 'req-1',
        tenant_id: 'tenant-1',
        route: '/api/v1/students',
        res: { statusCode: 200 },
        duration_ms: 12,
      },
      'request completed',
    );

    const parsed = JSON.parse(lines[0]);
    expect(parsed.request_id).toBe('req-1');
    expect(parsed.tenant_id).toBe('tenant-1');
    expect(parsed.route).toBe('/api/v1/students');
    expect(parsed.res.statusCode).toBe(200);
    expect(parsed.duration_ms).toBe(12);
  });

  it('never mounts a pino-pretty transport in production', () => {
    const options = buildPinoOptions('production');
    expect(options?.transport).toBeUndefined();
  });

  it('mounts a pino-pretty transport outside production', () => {
    const options = buildPinoOptions('development');
    expect(options?.transport).toEqual({ target: 'pino-pretty', options: { singleLine: true } });
  });

  it('silences health check routes', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { url: '/api/health' } as any;
    expect(options?.customLogLevel?.(fakeReq, {} as any, undefined)).toBe('silent');
  });

  it('logs non-health routes at info', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { url: '/api/v1/students' } as any;
    expect(options?.customLogLevel?.(fakeReq, {} as any, undefined)).toBe('info');
  });

  it('sets tenant_id null and route null when absent', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { headers: { 'x-request-id': 'req-2' } } as any;

    const props = options?.customProps?.(fakeReq, {} as any) as Record<string, unknown>;

    expect(props.request_id).toBe('req-2');
    expect(props.tenant_id).toBeNull();
    expect(props.route).toBeNull();
  });

  it('genReqId reuses an incoming X-Request-Id header', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { headers: { 'x-request-id': 'incoming-id' } } as any;

    expect(options?.genReqId?.(fakeReq, {} as any)).toBe('incoming-id');
  });

  it('genReqId mints and stamps a fresh id when none arrives', () => {
    const options = buildPinoOptions('production');
    const fakeReq = { headers: {} } as any;

    const id = options?.genReqId?.(fakeReq, {} as any) as string;

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(fakeReq.headers['x-request-id']).toBe(id);
  });
});
