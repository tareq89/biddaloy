import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter', () => {
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockSetHeader: ReturnType<typeof vi.fn>;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    mockJson = vi.fn();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    mockSetHeader = vi.fn();
    mockResponse = { status: mockStatus, setHeader: mockSetHeader };
    mockRequest = { method: 'GET', url: '/test', headers: {} };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Protects the public error-response contract: clients (the SPAs) rely on
  // 4xx messages to act on validation/auth/tenant errors, in every environment.
  it('passes a 4xx message through unchanged in production', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(new BadRequestException('Validation failed'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, message: 'Validation failed' }),
    );
  });

  // Protects production data confidentiality: a wrapped TypeORM error or an
  // InternalServerErrorException(err.message) can carry a query fragment,
  // column name, or connection string — this must never reach the client.
  it('suppresses 5xx detail in production', () => {
    const filter = new AllExceptionsFilter('production');
    const exception = new InternalServerErrorException('relation "users" does not exist');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });

  it('passes a ValidationPipe-style array message through as an array', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(
      new BadRequestException(['name should not be empty', 'email must be an email']),
      mockHost,
    );

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toEqual(['name should not be empty', 'email must be an email']);
  });

  it('includes 5xx detail and stack outside production', () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('relation "users" does not exist');

    filter.catch(exception, mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('relation "users" does not exist');
    expect(body.stack).toBe(exception.stack);
  });

  it('suppresses a non-HttpException 500 in production and logs the real detail', () => {
    const filter = new AllExceptionsFilter('production');
    const exception = new Error('connection to postgres://user:pass@host failed');

    filter.catch(exception, mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('connection to postgres://user:pass@host failed'),
      exception.stack,
    );
  });

  it('generates a requestId, returns it in the body and the X-Request-Id header', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(mockSetHeader).toHaveBeenCalledWith('X-Request-Id', body.requestId);
  });

  it('reuses an incoming X-Request-Id header instead of generating a new one', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.headers['x-request-id'] = 'client-supplied-id';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.requestId).toBe('client-supplied-id');
    expect(mockSetHeader).toHaveBeenCalledWith('X-Request-Id', 'client-supplied-id');
  });

  it('includes the requestId in the server-side log line', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.headers['x-request-id'] = 'log-correlation-id';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('[requestId=log-correlation-id]'),
      expect.any(String),
    );
  });

  it('defaults nodeEnv from process.env.NODE_ENV when not passed', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const filter = new AllExceptionsFilter();
      const exception = new InternalServerErrorException('leaky detail');

      filter.catch(exception, mockHost);

      const body = mockJson.mock.calls[0][0];
      expect(body.message).toBe('Internal server error');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('includes timestamp and path in the response body', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.url = '/api/things';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.path).toBe('/api/things');
    expect(typeof body.timestamp).toBe('string');
    // new Date(invalid) returns an Invalid Date rather than throwing, so
    // Date.parse is the assertion that can actually fail on a bad string.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('handles null/undefined exceptions with 500', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(null, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson.mock.calls[0][0].message).toBe('Internal server error');
  });

  // Tested against a genuinely failing request, not a successful one — a
  // redaction helper that only runs on the happy path is worthless, since
  // the leak is usually in an error log written under debugging pressure.
  it('redacts PII from the request URL before logging a failing request', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.url = '/api/v1/students?email=guardian@example.com';

    filter.catch(new BadRequestException('Invalid query'), mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.not.stringContaining('guardian@example.com'),
      expect.anything(),
    );
  });

  it("redacts PII embedded in the exception's own detail message", () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('duplicate key for guardian@example.com');

    filter.catch(exception, mockHost);

    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('[REDACTED_EMAIL]'),
      ),
    ).toBe(true);
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('guardian@example.com'),
      ),
    ).toBe(false);
  });

  // Logger.error's stack argument is a separate parameter from the message
  // redactPii() is applied to — and Error.stack's own first line repeats
  // the exception's message, so it carries the same PII if left unredacted.
  it('redacts PII from the exception stack, not just the message', () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('duplicate key for guardian@example.com');

    filter.catch(exception, mockHost);

    expect(exception.stack).toContain('guardian@example.com');
    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('guardian@example.com'),
      ),
    ).toBe(false);
  });

  // The login path carries a plaintext password in the request body — this
  // filter must never reference request.body at all, in any form.
  it('never logs the request body, even when it carries a password', () => {
    const filter = new AllExceptionsFilter('development');
    mockRequest.body = { email: 'admin@example.com', password: 'hunter2' };

    filter.catch(new BadRequestException('Invalid credentials'), mockHost);

    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('hunter2')),
    ).toBe(false);
  });
});
