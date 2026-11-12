import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SupportAccessModule } from './support-access.module';
import { AuthModule } from '../auth/auth.module';
import { SchoolsModule } from '../schools/schools.module';
import { ImpersonationSession } from './entities/impersonation-session.entity';
import { PlatformSchoolNote } from './entities/platform-school-note.entity';
import { PlatformAnnouncement } from './entities/platform-announcement.entity';
import { ImpersonationSessionService } from './sessions/impersonation-session.service';
import { ImpersonationCodeService } from './exchange/impersonation-code.service';
import { LoginAsCandidatesService } from './candidates/login-as-candidates.service';
import { ImpersonationExchangeController } from './exchange/impersonation-exchange.controller';
import { LoginAsCandidatesController } from './candidates/login-as-candidates.controller';
import { PlatformImpersonationController } from './platform-impersonation.controller';
import { DenyWhenImpersonatingInterceptor } from '../auth/deny-when-impersonating.interceptor';
import { requestActorContextMiddleware } from '../../common/request-actor-context';
import { ConsentGateService } from './consent/consent-gate.service';
import { SupportAccessSettingsController } from './consent/support-access-settings.controller';
import { SupportAccessSettingsService } from './consent/support-access-settings.service';
import { SupportAccessNoticeService } from './notices/support-access-notice.service';
import { SupportRequestsController } from './requests/support-requests.controller';
import { SupportRequestsService } from './requests/support-requests.service';
import { SupportSessionsController } from './school-view/support-sessions.controller';
import { SupportSessionsService } from './school-view/support-sessions.service';
import { IMPERSONATION_REDIS } from './sessions/impersonation-redis';

const meta = (key: string) => Reflect.getMetadata(key, SupportAccessModule) as unknown[];

describe('SupportAccessModule', () => {
  it('registers the support-access repositories and imports Auth and Schools', () => {
    const imports = meta(MODULE_METADATA.IMPORTS) as (
      { providers?: { provide: unknown }[] } | unknown
    )[];
    expect(imports).toContain(AuthModule);
    expect(imports).toContain(SchoolsModule);
    const tokens = imports
      .flatMap((i) => (i as { providers?: { provide: unknown }[] }).providers ?? [])
      .map((p) => p.provide);
    expect(tokens).toEqual(
      expect.arrayContaining([
        getRepositoryToken(ImpersonationSession),
        getRepositoryToken(PlatformSchoolNote),
        getRepositoryToken(PlatformAnnouncement),
      ]),
    );
  });

  it('provides the services and the deny interceptor, and mounts the six controllers', () => {
    const providers = meta(MODULE_METADATA.PROVIDERS);
    expect(providers).toEqual(
      expect.arrayContaining([
        ImpersonationSessionService,
        ImpersonationCodeService,
        LoginAsCandidatesService,
        ConsentGateService,
        SupportAccessNoticeService,
        SupportAccessSettingsService,
        SupportRequestsService,
        SupportSessionsService,
        { provide: APP_INTERCEPTOR, useClass: DenyWhenImpersonatingInterceptor },
      ]),
    );
    expect(meta(MODULE_METADATA.CONTROLLERS)).toEqual([
      ImpersonationExchangeController,
      LoginAsCandidatesController,
      PlatformImpersonationController,
      SupportAccessSettingsController,
      SupportRequestsController,
      SupportSessionsController,
    ]);
  });

  it('does not open a second Redis client: IMPERSONATION_REDIS comes from AuthModule', () => {
    const providers = meta(MODULE_METADATA.PROVIDERS) as { provide?: unknown }[];
    expect(providers.some((p) => p?.provide === IMPERSONATION_REDIS)).toBe(false);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule)).toContain(IMPERSONATION_REDIS);
  });

  it('applies the request actor middleware to every route', () => {
    const apply = vi.fn(() => ({ forRoutes }));
    const forRoutes = vi.fn();
    new SupportAccessModule().configure({ apply } as never);
    expect(apply).toHaveBeenCalledWith(requestActorContextMiddleware);
    expect(forRoutes).toHaveBeenCalledWith('*');
  });
});
