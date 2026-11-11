import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { SupportAccessModule } from './support-access.module';

describe('SupportAccessModule', () => {
  it('registers the three support-access repositories and nothing else yet', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, SupportAccessModule) as unknown[];
    expect(imports).toHaveLength(1);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SupportAccessModule)).toBeUndefined();
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SupportAccessModule)).toBeUndefined();
  });
});
