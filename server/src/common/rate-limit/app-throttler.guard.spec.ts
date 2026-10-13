import { describe, it, expect } from 'vitest';
import { requiresRedis } from './app-throttler.guard';

describe('requiresRedis', () => {
  // Sign-in, code, reset, register and step-up: unlimited guessing without a rate limiter.
  it.each([
    ['POST', '/api/v1/auth/login'],
    ['POST', '/api/v1/auth/otp/request'],
    ['POST', '/api/v1/auth/forgot-password'],
    ['POST', '/api/v1/auth/step-up'],
    ['POST', '/api/v1/auth/register'],
    // Checks current_password outside /auth/ (75.18 review r1).
    ['POST', '/api/v1/users/me/contact-change'],
  ])('is true for %s %s', (method, path) => {
    expect(requiresRedis(method, path)).toBe(true);
  });

  // These keep signed-in people signed in; refresh tokens are DB rows, not guessable.
  it.each([
    ['POST', '/api/v1/auth/refresh'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/logout-all'],
    ['GET', '/api/v1/auth/sessions'],
    ['DELETE', '/api/v1/auth/sessions/:id'],
    ['GET', '/api/v1/students'],
    ['POST', '/api/v1/users/me/contact-change/confirm-phone'],
  ])('is false for %s %s', (method, path) => {
    expect(requiresRedis(method, path)).toBe(false);
  });

  it('ignores method case and works without the /api/v<n> prefix', () => {
    expect(requiresRedis('post', '/auth/login')).toBe(true);
    expect(requiresRedis('post', '/auth/refresh')).toBe(false);
  });
});
