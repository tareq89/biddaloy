import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger as NestLogger } from '@nestjs/common';
import { RedactingTypeOrmLogger } from './db-logger';

describe('RedactingTypeOrmLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(NestLogger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('logs the query text but never the bound parameters', () => {
    const logger = new RedactingTypeOrmLogger(true);

    logger.logQuery('SELECT * FROM users WHERE email = $1', ['admin@example.com']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message] = logSpy.mock.calls[0];
    expect(String(message)).toContain('SELECT * FROM users WHERE email = $1');
    expect(String(message)).not.toContain('admin@example.com');
    expect(String(message)).not.toContain('PARAMETERS');
  });

  // The issue's own gotcha: redaction that only works on the happy path is
  // worthless — a failing query is exactly where debugging pressure tempts
  // someone to log everything, including the parameters that just failed.
  it('logs a failing query without its parameters either', () => {
    const logger = new RedactingTypeOrmLogger(true);

    logger.logQueryError('duplicate key value', 'INSERT INTO users (email) VALUES ($1)', ['admin@example.com']);

    expect(warnSpy).toHaveBeenCalled();
    const allText = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(allText).toContain('INSERT INTO users (email) VALUES ($1)');
    expect(allText).not.toContain('admin@example.com');
  });

  // appendParameterAsComment: false only covers the query's own bound
  // parameters — logQueryError's second message carries the raw driver
  // error text separately, and a real Postgres constraint violation can
  // echo the offending value back in that text (e.g. "Key (email)=(...)
  // already exists").
  it('redacts PII embedded in the driver error text itself, not just bound parameters', () => {
    const logger = new RedactingTypeOrmLogger(true);

    logger.logQueryError(
      'duplicate key value violates unique constraint — Key (email)=(admin@example.com) already exists',
      'INSERT INTO users (email) VALUES ($1)',
      ['admin@example.com'],
    );

    const allText = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(allText).toContain('[REDACTED_EMAIL]');
    expect(allText).not.toContain('admin@example.com');
  });

  it('respects the logging option — stays silent when logging is disabled', () => {
    const logger = new RedactingTypeOrmLogger(false);

    logger.logQuery('SELECT 1', []);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
