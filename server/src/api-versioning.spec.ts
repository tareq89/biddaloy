import { describe, it, expect } from 'vitest';
import { VersioningType } from '@nestjs/common';
import { API_VERSION, buildVersioningOptions } from './api-versioning';

describe('buildVersioningOptions', () => {
  it('uses URI versioning', () => {
    expect(buildVersioningOptions().type).toBe(VersioningType.URI);
  });

  it('defaults every route to the current API_VERSION', () => {
    expect(buildVersioningOptions().defaultVersion).toBe(API_VERSION);
  });

  // Pins the value main.ts and the e2e helper build /api/v1/... from —
  // a change here is a real version bump, not a refactor.
  it('is version 1', () => {
    expect(API_VERSION).toBe('1');
  });
});
