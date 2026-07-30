import { describe, it, expect } from 'vitest';
import { resolveCorsOrigins } from './cors-origins';

describe('resolveCorsOrigins', () => {
  it('parses a single origin from CORS_ORIGINS', () => {
    expect(resolveCorsOrigins('https://app.example.com', 'production')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('parses a comma-separated list, trimming whitespace', () => {
    expect(resolveCorsOrigins(' https://app.example.com , https://admin.example.com ', 'production')).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('drops empty entries from a trailing or double comma', () => {
    expect(resolveCorsOrigins('https://app.example.com,,', 'production')).toEqual([
      'https://app.example.com',
    ]);
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
