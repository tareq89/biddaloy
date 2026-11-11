import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SupportAccessModule } from './support-access.module';
import { ImpersonationSession } from './entities/impersonation-session.entity';
import { PlatformSchoolNote } from './entities/platform-school-note.entity';
import { PlatformAnnouncement } from './entities/platform-announcement.entity';

describe('SupportAccessModule', () => {
  it('registers the three support-access repositories and nothing else yet', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, SupportAccessModule) as {
      providers: { provide: unknown }[];
    }[];
    expect(imports).toHaveLength(1);
    // TypeOrmModule.forFeature provides one repository token per entity.
    const tokens = imports[0].providers.map((p) => p.provide);
    expect(tokens).toEqual(
      expect.arrayContaining([
        getRepositoryToken(ImpersonationSession),
        getRepositoryToken(PlatformSchoolNote),
        getRepositoryToken(PlatformAnnouncement),
      ]),
    );
    // Wave 2 adds providers and controllers (D28).
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SupportAccessModule)).toBeUndefined();
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SupportAccessModule)).toBeUndefined();
  });
});
