import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { DemoController } from './demo.controller';
import { DEMO_CARDS } from './demo-accounts';

const controller = (env: Record<string, string | undefined>) =>
  new DemoController({ get: (k: string) => env[k] } as unknown as ConfigService);

describe('DemoController', () => {
  it('answers enabled: false (not a 404) when DEMO_MODE is off, and leaks no password', () => {
    expect(controller({ DEMO_PASSWORD: 'demo-pass-1' }).roles()).toEqual({
      enabled: false,
      password: '',
      cards: [],
    });
  });

  it('returns the cards and the shared password when on', () => {
    const res = controller({ DEMO_MODE: 'true', DEMO_PASSWORD: 'demo-pass-1' }).roles();
    expect(res.enabled).toBe(true);
    expect(res.password).toBe('demo-pass-1');
    expect(res.cards).toEqual(DEMO_CARDS);
  });

  it('only uses @bmsc.example logins (D26)', () => {
    expect(DEMO_CARDS.every((c) => c.email.endsWith('@bmsc.example'))).toBe(true);
  });
});
