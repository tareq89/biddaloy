import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { requestActorContextMiddleware } from '../../common/request-actor-context';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DenyWhenImpersonatingInterceptor } from '../auth/deny-when-impersonating.interceptor';
import { AccountAccessModule } from '../account-access/account-access.module';
import { TrialModule } from '../schools/trial/trial.module';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { SchoolsModule } from '../schools/schools.module';
import { User } from '../users/entities/user.entity';
import { LoginAsCandidatesController } from './candidates/login-as-candidates.controller';
import { LoginAsCandidatesService } from './candidates/login-as-candidates.service';
import { ImpersonationSession } from './entities/impersonation-session.entity';
import { PlatformAnnouncement } from './entities/platform-announcement.entity';
import { PlatformSchoolNote } from './entities/platform-school-note.entity';
import { ImpersonationCodeService } from './exchange/impersonation-code.service';
import { ImpersonationExchangeController } from './exchange/impersonation-exchange.controller';
import { PlatformImpersonationController } from './platform-impersonation.controller';
import { ImpersonationSessionService } from './sessions/impersonation-session.service';
import { ConsentGateService } from './consent/consent-gate.service';
import { SupportAccessSettingsController } from './consent/support-access-settings.controller';
import { SupportAccessSettingsService } from './consent/support-access-settings.service';
import { SupportAccessNoticeService } from './notices/support-access-notice.service';
import { SupportRequestsController } from './requests/support-requests.controller';
import { SupportRequestsService } from './requests/support-requests.service';
import { SupportSessionsController } from './school-view/support-sessions.controller';
import { SupportSessionsService } from './school-view/support-sessions.service';
import { School } from '../schools/entities/school.entity';

// IMPERSONATION_REDIS is provided and exported by AuthModule (JwtStrategy reads it too), so this
// module shares that one client by importing AuthModule instead of opening a second connection.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ImpersonationSession,
      PlatformSchoolNote,
      PlatformAnnouncement,
      User,
      School,
    ]),
    AuthModule,
    SchoolsModule,
    AuditModule,
    PlatformIdentityModule,
    TrialModule,
    AccountAccessModule,
  ],
  controllers: [
    ImpersonationExchangeController,
    LoginAsCandidatesController,
    PlatformImpersonationController,
    SupportAccessSettingsController,
    SupportRequestsController,
    SupportSessionsController,
  ],
  providers: [
    ImpersonationSessionService,
    ImpersonationCodeService,
    LoginAsCandidatesService,
    ConsentGateService,
    SupportAccessNoticeService,
    SupportAccessSettingsService,
    SupportRequestsService,
    SupportSessionsService,
    { provide: APP_INTERCEPTOR, useClass: DenyWhenImpersonatingInterceptor },
  ],
  exports: [ImpersonationSessionService],
})
export class SupportAccessModule implements NestModule {
  // One request-actor store per request, filled by JwtStrategy when the token is a Login as token.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestActorContextMiddleware).forRoutes('*');
  }
}
