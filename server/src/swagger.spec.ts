import { describe, it, expect } from 'vitest';
import { buildSwaggerDocumentConfig, shouldMountDocs, DOCS_PATH } from './swagger';

describe('shouldMountDocs', () => {
  it('mounts in development', () => {
    expect(shouldMountDocs('development', undefined)).toBe(true);
  });

  it('mounts in test', () => {
    expect(shouldMountDocs('test', undefined)).toBe(true);
  });

  it('mounts when NODE_ENV is unset', () => {
    expect(shouldMountDocs(undefined, undefined)).toBe(true);
  });

  it('does not mount in production without ENABLE_API_DOCS', () => {
    expect(shouldMountDocs('production', undefined)).toBe(false);
  });

  it("does not mount in production when ENABLE_API_DOCS is not exactly 'true'", () => {
    expect(shouldMountDocs('production', '1')).toBe(false);
    expect(shouldMountDocs('production', 'yes')).toBe(false);
  });

  it("mounts in production when ENABLE_API_DOCS is exactly 'true'", () => {
    expect(shouldMountDocs('production', 'true')).toBe(true);
  });
});

describe('buildSwaggerDocumentConfig', () => {
  it("registers a bearer scheme named 'bearer'", () => {
    const config = buildSwaggerDocumentConfig();

    expect(config.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('sets a title and version', () => {
    const config = buildSwaggerDocumentConfig();

    expect(config.info.title).toBeTruthy();
    expect(config.info.version).toBeTruthy();
  });
});

describe('DOCS_PATH', () => {
  it('is a bare path segment, not a leading-slash path', () => {
    expect(DOCS_PATH).toBe('docs');
  });
});
