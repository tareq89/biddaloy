# Graph Report - server  (2026-08-24)

## Corpus Check
- 313 files · ~161,779 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1991 nodes · 5315 edges · 123 communities (71 shown, 52 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 95 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5130c8cc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Teacher
- SanitizeText
- fees.controller.ts
- School
- auth.controller.ts
- invoices.controller.ts
- payment-allocation.service.integration.spec.ts
- audit.controller.ts
- fees.service.integration.spec.ts
- Student
- tenant-provider-config.resolver.ts
- tenant-settings.dto.ts
- ClassController
- Enrollment
- User
- outbound-destination-guard.ts
- AppModule
- all-entities.ts
- Roles
- http-exception.filter.ts
- AcademicYearController
- .testConnection
- compilerOptions
- StudentController
- provider-connection-test.controller.ts
- CommunicationLog
- greenweb-sms.gateway.ts
- reminders.service.ts
- RefreshTokenService
- communications.module.ts
- communications.controller.ts
- CurrentTenant
- SchoolsService
- SendBulkReminderDto
- app.module.ts
- scripts
- smtp-email.provider.ts
- schools.service.ts
- AccessTokenDenylistService
- @nestjs/swagger
- AuditService
- EncryptionService
- SendSingleReminderDto
- AuthService
- LoginAttemptService
- settings-mask.util.ts
- EnrollmentController
- schools.controller.ts
- .updateSettings
- devDependencies
- auth.service.ts
- db.helper.ts
- auth.module.ts
- classes.controller.ts
- exclude
- exclude
- schools.module.ts
- EnvironmentVariables
- NestJS Testing Standards
- @biddaloy/server — NestJS Backend
- tenant-settings-defaults.ts
- AppController
- dependencies
- nest-cli.json
- single-reminder.dto.ts
- FailOpenThrottlerStorage
- tenant-provider-config.resolver.spec.ts
- spa-fallback.spec.ts
- buildCorsOptions
- reminders.service.spec.ts
- buildHelmetOptions
- package.json
- rate-limit-tracker.ts
- InitialSchema1784175065078
- MultiTenantAuth1784175065079
- AddTenantIsolationAndEnrollments1784175065080
- AddTenantIdToCommunicationLogs1785304003457
- AddReminderBatchTenantAndLogLink1785316147772
- AddLoginFailedAuditAction1785702546209
- AddRefreshTokens1785740608549
- AddTenantIdToAuditLogs1785749259955
- AddSettingsChangeAuditAction1786097609707
- AddSettingsTestAuditAction1786642308000
- AddSingleReminderCommunicationTrigger1787486700000
- auth.e2e-spec.ts
- single-reminder.service.spec.ts
- payment-allocation.e2e-spec.ts
- validation-pipe.spec.ts
- db-clear.ts
- bcrypt
- class-transformer
- class-validator
- cookie-parser
- helmet
- ioredis
- @nest-lab/throttler-storage-redis
- @nestjs/bullmq
- @nestjs/cli
- @nestjs/common
- @nestjs/config
- @nestjs/core
- @nestjs/jwt
- @nestjs/passport
- @nestjs/swagger
- @nestjs/testing
- @nestjs/throttler
- @nestjs/typeorm
- nodemailer
- passport
- passport-jwt
- pg
- reflect-metadata
- rxjs
- typeorm
- undici
- supertest
- ts-node
- @types/cookie-parser
- typescript
- vitest

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 87 edges
2. `Student` - 85 edges
3. `CurrentTenant` - 84 edges
4. `School` - 72 edges
5. `User` - 68 edges
6. `ClassSection` - 66 edges
7. `Class` - 64 edges
8. `AcademicYear` - 61 edges
9. `Guardian` - 40 edges
10. `StudentFee` - 38 edges

## Surprising Connections (you probably didn't know these)
- `configureApiVersioning()` --calls--> `buildVersioningOptions()`  [EXTRACTED]
  test/helpers/e2e-app.helper.ts → src/api-versioning.ts
- `bootstrap()` --indirect_call--> `AppModule`  [INFERRED]
  src/main.ts → src/app.module.ts
- `generateOpenApiDocument()` --indirect_call--> `AppModule`  [INFERRED]
  src/scripts/generate-openapi.ts → src/app.module.ts
- `reencryptSettings()` --indirect_call--> `AppModule`  [INFERRED]
  src/scripts/reencrypt-settings.ts → src/app.module.ts
- `seed()` --indirect_call--> `AppModule`  [INFERRED]
  src/scripts/seed.ts → src/app.module.ts

## Import Cycles
- None detected.

## Communities (123 total, 52 thin omitted)

### Community 0 - "Teacher"
Cohesion: 0.05
Nodes (60): TeacherClassSection, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique (+52 more)

### Community 1 - "SanitizeText"
Cohesion: 0.05
Nodes (55): SanitizeAllowlist(), SanitizeText(), shared, AllowlistDto, { sanitizeAllowlist, sanitizeStrict }, StrictDto, CreateAcademicYearDto, IsBeforeConstraint (+47 more)

### Community 2 - "fees.controller.ts"
Cohesion: 0.07
Nodes (44): CreateFeeStructureDto, CreatePaymentDto, FeeDuesSortBy, GenerateFeesResultDto, GenerateStudentFeesDto, PaymentAllocationInputDto, QueryFeeDuesDto, QueryFeeStructureDto (+36 more)

### Community 3 - "School"
Cohesion: 0.05
Nodes (54): InjectRepository, AcademicYear, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn (+46 more)

### Community 4 - "auth.controller.ts"
Cohesion: 0.06
Nodes (34): ApiBearerAuth, ApiUnauthorizedResponse, AuthController, mockIssuedRefreshToken, ApiOperation, ApiTags, Body, Controller (+26 more)

### Community 5 - "invoices.controller.ts"
Cohesion: 0.06
Nodes (39): Header, AuditInterceptor, RequestWithTenant, Injectable, Audited(), AuditedMetadata, CreateInvoiceDto, LineItemDto (+31 more)

### Community 6 - "payment-allocation.service.integration.spec.ts"
Cohesion: 0.07
Nodes (40): PaymentAllocation, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+32 more)

### Community 7 - "audit.controller.ts"
Cohesion: 0.06
Nodes (32): AuditController, ApiOperation, ApiResponse, ApiTags, Controller, Get, Inject, Param (+24 more)

### Community 8 - "fees.service.integration.spec.ts"
Cohesion: 0.09
Nodes (30): Check, FeeStructure, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn (+22 more)

### Community 9 - "Student"
Cohesion: 0.07
Nodes (31): JoinTable, InjectRepository, Guardian, Column, CreateDateColumn, DeleteDateColumn, Entity, Index (+23 more)

### Community 10 - "tenant-provider-config.resolver.ts"
Cohesion: 0.12
Nodes (20): ProviderNotConfiguredError, EmailOverride, MessengerOverride, ResolvedMessengerConfig, ResolvedSmsConfig, ResolvedWhatsAppConfig, SmsOverride, WhatsAppOverride (+12 more)

### Community 11 - "tenant-settings.dto.ts"
Cohesion: 0.12
Nodes (30): CommunicationsSettingsDto, EmailSettingsDto, GreenwebSmsDto, MessengerSettingsDto, MimSmsDto, RegionAcademicYearDto, RegionAddressDto, RegionCurrencyDto (+22 more)

### Community 12 - "ClassController"
Cohesion: 0.10
Nodes (16): ClassController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+8 more)

### Community 13 - "Enrollment"
Cohesion: 0.13
Nodes (15): AcademicYearStats, createStudentEnrolledIn(), EnrollmentService, Injectable, GuardianInput, Enrollment, Column, CreateDateColumn (+7 more)

### Community 14 - "User"
Cohesion: 0.10
Nodes (27): ApiHideProperty, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+19 more)

### Community 15 - "outbound-destination-guard.ts"
Cohesion: 0.12
Nodes (25): DestinationBlockedError, OutboundDestinationError, assertResolvesToPublicAddress(), assertSafeHttpDestination(), assertSafeSmtpDestination(), DestinationBlockedError, DestinationResolutionError, ipv4ToInt() (+17 more)

### Community 16 - "AppModule"
Cohesion: 0.20
Nodes (6): AppModule, Module, DEFAULTS, createApp(), buildValidationPipeOptions(), configureApiVersioning()

### Community 17 - "all-entities.ts"
Cohesion: 0.20
Nodes (4): DEFAULTS, seedReferenceData(), ALL_ENTITIES, createTestModule()

### Community 18 - "Roles"
Cohesion: 0.15
Nodes (16): CurrentUser, Roles(), FeeController, ApiOperation, ApiTags, Body, Controller, Delete (+8 more)

### Community 19 - "http-exception.filter.ts"
Cohesion: 0.12
Nodes (16): Catch, buildErrorResponseBody(), ErrorResponseBody, resolveDetailMessage(), resolveStatus(), AllExceptionsFilter, applyRedaction(), redactPii() (+8 more)

### Community 20 - "AcademicYearController"
Cohesion: 0.12
Nodes (15): AcademicYearController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+7 more)

### Community 21 - ".testConnection"
Cohesion: 0.08
Nodes (21): IsObject, TestConnectionDto, IsIn, IsOptional, TESTABLE_MEDIA, TestableCommunicationMedium, ProviderConnectionTestController, REQUEST (+13 more)

### Community 22 - "compilerOptions"
Cohesion: 0.07
Nodes (28): multer, ../shared/dist, ../tsconfig.base.json, vitest/globals, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators (+20 more)

### Community 23 - "StudentController"
Cohesion: 0.12
Nodes (17): ApiBody, ApiConsumes, StudentController, ApiOperation, ApiTags, Body, Controller, Delete (+9 more)

### Community 24 - "provider-connection-test.controller.ts"
Cohesion: 0.11
Nodes (16): ApiTenantAuth(), TestController, QueryAcademicYearDto, IsInt, IsOptional, Max, Min, Type (+8 more)

### Community 25 - "CommunicationLog"
Cohesion: 0.08
Nodes (24): InjectQueue, InjectRepository, CommunicationLog, Column, CreateDateColumn, Entity, Index, JoinColumn (+16 more)

### Community 26 - "greenweb-sms.gateway.ts"
Cohesion: 0.18
Nodes (11): ResolvedGreenwebSmsConfig, ResolvedMimSmsConfig, CommunicationSendResult, ConnectionTestResult, normalizeBdPhoneNumber(), GreenwebSmsGateway, Injectable, MimSmsGateway (+3 more)

### Community 27 - "reminders.service.ts"
Cohesion: 0.21
Nodes (18): requestContext, addressForMedium(), DISPATCHABLE_MEDIA, selectReminderGuardians(), findUnsupportedPlaceholders(), formatDueAmount(), formatDueMonth(), isSupportedPlaceholder() (+10 more)

### Community 28 - "RefreshTokenService"
Cohesion: 0.12
Nodes (14): RefreshToken, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+6 more)

### Community 29 - "communications.module.ts"
Cohesion: 0.12
Nodes (11): CommunicationsModule, Module, CommunicationProviderRegistry, CommunicationProviderRegistryService, Injectable, BatchOutcome, recordBatchOutcome(), CommunicationsProcessor (+3 more)

### Community 30 - "communications.controller.ts"
Cohesion: 0.15
Nodes (15): CommunicationsService, toResponseDto(), Injectable, CommunicationResponseDto, LastReminderDto, QueryLastRemindersDto, SendCommunicationDto, ArrayMinSize (+7 more)

### Community 31 - "CurrentTenant"
Cohesion: 0.20
Nodes (15): CurrentTenant, CommunicationsController, ApiOkResponse, ApiOperation, ApiTags, Body, Controller, Get (+7 more)

### Community 32 - "SchoolsService"
Cohesion: 0.12
Nodes (7): SchoolsService, REQUEST_CONTEXT, Injectable, InjectRepository, CacheEntry, TenantSettingsCache, Injectable

### Community 33 - "SendBulkReminderDto"
Cohesion: 0.15
Nodes (14): ArrayMaxSize, ReminderBatchResponseDto, SendBulkReminderDto, SkippedRecipientDto, ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty (+6 more)

### Community 34 - "app.module.ts"
Cohesion: 0.11
Nodes (17): AcademicYearModule, Module, ClassModule, Module, ClassSectionWithCount, ClassTeacher, ClassWithCounts, EnrollmentModule (+9 more)

### Community 35 - "scripts"
Cohesion: 0.09
Nodes (22): scripts, build, db:clear, db:reset, docs:generate, lint, migration:generate, migration:revert (+14 more)

### Community 36 - "smtp-email.provider.ts"
Cohesion: 0.16
Nodes (11): ResolvedEmailConfig, TenantProviderConfigResolver, Injectable, CommunicationSendParams, isSmtpConnectionError(), mapSmtpError(), SMTP_CONNECTION_ERROR_CODES, SmtpEmailProvider (+3 more)

### Community 37 - "schools.service.ts"
Cohesion: 0.18
Nodes (14): toDto(), VALIDATION_OPTIONS, TenantSettingsDto, patch(), REQUEST, USER, isPlainObject(), pickPatchShape() (+6 more)

### Community 38 - "AccessTokenDenylistService"
Cohesion: 0.14
Nodes (8): Optional, AccessTokenDenylistService, Inject, Injectable, Inject, InjectRepository, JwtStrategy, Injectable

### Community 39 - "@nestjs/swagger"
Cohesion: 0.26
Nodes (10): @nestjs/swagger, buildVersioningOptions(), buildDocsBasicAuthMiddleware(), buildDocsCspOverrideMiddleware(), safeCompare(), bootstrap(), generateOpenApiDocument(), buildSwaggerDocumentConfig() (+2 more)

### Community 40 - "AuditService"
Cohesion: 0.11
Nodes (14): AuditModule, Module, AuditService, RecordAuditEntryInput, Injectable, InjectRepository, AuditLog, Column (+6 more)

### Community 41 - "EncryptionService"
Cohesion: 0.20
Nodes (8): EncryptionService, isEncryptedEnvelope(), Injectable, decryptSecretFields(), encryptSecretFields(), reencryptSecretFields(), resolveParent(), transformAtPaths()

### Community 42 - "SendSingleReminderDto"
Cohesion: 0.15
Nodes (12): Inject, SendSingleReminderDto, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID (+4 more)

### Community 43 - "AuthService"
Cohesion: 0.21
Nodes (7): redact(), redactSensitiveFields(), SENSITIVE_KEYS, AuthService, sleep(), Injectable, RequestContext

### Community 44 - "LoginAttemptService"
Cohesion: 0.17
Nodes (3): LoginAttemptRedisClient, LoginAttemptResult, LoginAttemptService

### Community 45 - "settings-mask.util.ts"
Cohesion: 0.17
Nodes (12): ClassRef, getNestedType(), NESTED_TYPE_METADATA_KEY, isSecretProperty(), SECRET_METADATA_KEY, ClassRef, getSecretPaths(), isPlainObject() (+4 more)

### Community 46 - "EnrollmentController"
Cohesion: 0.14
Nodes (12): ApiExtraModels, EnrollmentController, ApiOkResponse, ApiTags, Body, Controller, Get, Param (+4 more)

### Community 47 - "schools.controller.ts"
Cohesion: 0.19
Nodes (14): assertCanManageSchool(), SchoolListItemDto, ApiProperty, MaskedCommunicationsSettingsResponseDto, MaskedEmailSettingsResponseDto, MaskedGreenwebSmsResponseDto, MaskedMessengerSettingsResponseDto, MaskedMimSmsResponseDto (+6 more)

### Community 48 - ".updateSettings"
Cohesion: 0.16
Nodes (13): SchoolsController, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, Body, Controller, Get (+5 more)

### Community 49 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, tsconfig-paths, @types/bcrypt, @types/express, @types/multer, @types/node, @types/nodemailer, @types/passport-jwt (+9 more)

### Community 50 - "auth.service.ts"
Cohesion: 0.18
Nodes (6): AuthResult, normalizeLoginIdentifier(), IssuedRefreshToken, RefreshTokenReuseDetectedException, RotateResult, fakeRepo()

### Community 51 - "db.helper.ts"
Cohesion: 0.14
Nodes (5): createMockRequest(), createTestJwtPayload(), clearTables(), assertTestDatabaseUrl(), setupTestDatabase()

### Community 52 - "auth.module.ts"
Cohesion: 0.17
Nodes (8): Global, AuthModule, Module, RefreshTokenCleanupProcessor, Processor, RefreshTokenCleanupScheduler, Injectable, InjectQueue

### Community 53 - "classes.controller.ts"
Cohesion: 0.35
Nodes (13): CreateClassDto, CreateSectionDto, QueryClassDto, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID (+5 more)

### Community 54 - "exclude"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 55 - "exclude"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 56 - "schools.module.ts"
Cohesion: 0.27
Nodes (8): encryptionServiceFactory(), SchoolsModule, Module, buildEncryptionKey(), buildPreviousEncryptionKeys(), decodeKey(), VALID_KEY, WRONG_LENGTH_KEY

### Community 57 - "EnvironmentVariables"
Cohesion: 0.20
Nodes (10): EnvironmentVariables, NODE_ENVS, validConfig, IsIn, IsNotEmpty, IsOptional, IsString, Matches (+2 more)

### Community 58 - "NestJS Testing Standards"
Cohesion: 0.18
Nodes (10): Core Principle, Coverage Targets (Minimum), Execution, File Naming Convention, Integration Test Database, Mandatory Scenarios, NestJS Testing Standards, Running Tests (+2 more)

### Community 59 - "@biddaloy/server — NestJS Backend"
Cohesion: 0.18
Nodes (10): Architecture Notes, @biddaloy/server — NestJS Backend, Build & Run, Commands, Database Migrations, Environment Variables, Lint & Test, Migration Workflow (+2 more)

### Community 60 - "tenant-settings-defaults.ts"
Cohesion: 0.44
Nodes (6): TENANT_SETTINGS_SCHEMA_VERSION, DEFAULT_REGION_SETTINGS, DEFAULT_TENANT_SETTINGS, isPlainObject(), overlayOnDefaults(), resolveTenantSettings()

### Community 61 - "AppController"
Cohesion: 0.29
Nodes (5): SkipThrottle, AppController, Controller, Get, Version

### Community 62 - "dependencies"
Cohesion: 0.29
Nodes (7): bullmq, exceljs, @nestjs/platform-express, dependencies, bullmq, exceljs, @nestjs/platform-express

### Community 63 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 64 - "single-reminder.dto.ts"
Cohesion: 0.29
Nodes (6): ReminderPreviewRecipientDto, ReminderPreviewResponseDto, SentReminderRecipientDto, SingleReminderResponseDto, SkippedGuardianDto, ResolvedContext

### Community 66 - "tenant-provider-config.resolver.spec.ts"
Cohesion: 0.53
Nodes (4): fakeCache(), fakeConfig(), fakeSchools(), resolverWith()

### Community 71 - "package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 87 - "validation-pipe.spec.ts"
Cohesion: 0.50
Nodes (3): TestDto, IsInt, IsString

## Knowledge Gaps
- **188 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `name` (+183 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **52 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `School` connect `School` to `Teacher`, `SchoolsService`, `app.module.ts`, `schools.service.ts`, `payment-allocation.service.integration.spec.ts`, `AuditService`, `fees.service.integration.spec.ts`, `Student`, `Enrollment`, `User`, `.updateSettings`, `all-entities.ts`, `schools.module.ts`, `CommunicationLog`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `Roles()` connect `Roles` to `Teacher`, `SanitizeText`, `fees.controller.ts`, `invoices.controller.ts`, `audit.controller.ts`, `ClassController`, `EnrollmentController`, `schools.controller.ts`, `.updateSettings`, `AcademicYearController`, `classes.controller.ts`, `.testConnection`, `StudentController`, `provider-connection-test.controller.ts`, `communications.controller.ts`, `CurrentTenant`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `User` connect `User` to `Teacher`, `app.module.ts`, `School`, `invoices.controller.ts`, `AccessTokenDenylistService`, `payment-allocation.service.integration.spec.ts`, `AuditService`, `fees.service.integration.spec.ts`, `Student`, `AuthService`, `AppModule`, `all-entities.ts`, `auth.service.ts`, `auth.module.ts`, `CommunicationLog`, `RefreshTokenService`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Student` (e.g. with `createStudentEnrolledIn()` and `.syncStudentPlacement()`) actually correct?**
  _`Student` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `School` (e.g. with `seedReferenceData()` and `seedReferenceData()`) actually correct?**
  _`School` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `User` (e.g. with `createTeacherOnSection()` and `seedReferenceData()`) actually correct?**
  _`User` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _188 weakly-connected nodes found - possible documentation gaps or missing edges._