import { describe, it, expect } from 'vitest';
import { resolveCorsOrigins, buildCorsOptions } from './cors-origins';

describe('resolveCorsOrigins', () => {
  it('parses a single origin from CORS_ORIGINS', () => {
    expect(resolveCorsOrigins('https://app.example.com', 'production')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('parses a comma-separated list, trimming whitespace', () => {
    expect(
      resolveCorsOrigins(' https://app.example.com , https://admin.example.com ', 'production'),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('drops empty entries from a trailing or double comma', () => {
    expect(resolveCorsOrigins('https://app.example.com,,', 'production')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('treats an explicitly empty CORS_ORIGINS the same as unset', () => {
    expect(resolveCorsOrigins('', 'development')).toEqual(['http://localhost:5173']);
    expect(resolveCorsOrigins('', 'production')).toEqual([]);
  });

  it('defaults to the Vite dev origin outside production when unset', () => {
    expect(resolveCorsOrigins(undefined, 'development')).toEqual(['http://localhost:5173']);
    expect(resolveCorsOrigins(undefined, 'test')).toEqual(['http://localhost:5173']);
    expect(resolveCorsOrigins(undefined, undefined)).toEqual(['http://localhost:5173']);
  });

  it('defaults to no allowed origins in production when unset', () => {
    expect(resolveCorsOrigins(undefined, 'production')).toEqual([]);
  });

  it('CORS_ORIGINS overrides the production default', () => {
    expect(resolveCorsOrigins('https://app.example.com', 'production')).toEqual([
      'https://app.example.com',
    ]);
  });
});

describe('buildCorsOptions', () => {
  it('includes the resolved origins, credentials, methods, and tenant/role headers', () => {
    const options = buildCorsOptions('https://app.example.com', 'production');

    expect(options).toEqual({
      origin: ['https://app.example.com'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Role'],
    });
  });
});
