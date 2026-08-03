import { describe, it, expect } from 'vitest';
import { DECORATORS } from '@nestjs/swagger';
import { ApiTenantAuth } from './api-tenant-auth.decorator';

@ApiTenantAuth()
class TestController {}

describe('ApiTenantAuth', () => {
  it('registers the bearer security scheme', () => {
    const security = Reflect.getMetadata(DECORATORS.API_SECURITY, TestController);

    expect(security).toEqual(expect.arrayContaining([{ bearer: [] }]));
  });

  it('documents X-Tenant-ID as required', () => {
    const headers = Reflect.getMetadata(DECORATORS.API_HEADERS, TestController);

    expect(headers).toContainEqual(expect.objectContaining({ name: 'X-Tenant-ID', required: true }));
  });

  it('documents X-Role as optional', () => {
    const headers = Reflect.getMetadata(DECORATORS.API_HEADERS, TestController);

    expect(headers).toContainEqual(expect.objectContaining({ name: 'X-Role', required: false }));
  });

  it('documents a 401 response', () => {
    const responses = Reflect.getMetadata(DECORATORS.API_RESPONSE, TestController);

    expect(responses).toHaveProperty('401');
  });
});
