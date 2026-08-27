# Graph Report - server  (2026-08-27)

## Corpus Check
- 332 files · ~198,679 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2128 nodes · 5810 edges · 136 communities (83 shown, 53 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 108 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5a22b885`
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
- ClassService
- smtp-email.provider.ts
- route-guard-coverage.e2e-spec.ts
- CreateAcademicYearDto
- redact.util.ts
- IsRegexSourceConstraint
- SmsProviderIsConfiguredConstraint
- AddReminderPreviewedAuditAction1787616000000
- AddGuardianNotificationsEnabled1787702400000
- IsBeforeConstraint
- @types/nodemailer
- @types/supertest

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 95 edges
2. `Student` - 95 edges
3. `CurrentTenant` - 92 edges
4. `School` - 73 edges
5. `User` - 70 edges
6. `ClassSection` - 66 edges
7. `Class` - 64 edges
8. `AcademicYear` - 61 edges
9. `Guardian` - 45 edges
10. `StudentFee` - 41 edges

## Surprising Connections (you probably didn't know these)
- `configureApiVersioning()` --calls--> `buildVersioningOptions()`  [EXTRACTED]
  test/helpers/e2e-app.helper.ts → src/api-versioning.ts
- `createApp()` --indirect_call--> `AppModule`  [INFERRED]
  src/trust-proxy.e2e-spec.ts → src/app.module.ts
- `toDto()` --indirect_call--> `TenantSettingsDto`  [INFERRED]
  src/modules/schools/dto/tenant-settings.dto.spec.ts → src/modules/schools/dto/tenant-settings.dto.ts
- `bootstrap()` --indirect_call--> `AppModule`  [INFERRED]
  src/main.ts → src/app.module.ts
- `generateOpenApiDocument()` --indirect_call--> `AppModule`  [INFERRED]
  src/scripts/generate-openapi.ts → src/app.module.ts

## Import Cycles
- None detected.

## Communities (136 total, 53 thin omitted)

### Community 0 - "Teacher"
Cohesion: 0.09
Nodes (33): CreateTeacherDto, CreateUserDto, QueryTeacherDto, QueryUserDto, IsArray, IsDateString, IsEmail, IsEnum (+25 more)

### Community 1 - "SanitizeText"
Cohesion: 0.12
Nodes (14): BulkUploadHeader, BulkUploadParseError, cellToString(), getExtension(), isRowBlank(), loadWorksheet(), ParsedRow, parseSpreadsheet() (+6 more)

### Community 2 - "fees.controller.ts"
Cohesion: 0.07
Nodes (46): CreateFeeStructureDto, CreatePaymentDto, FamilyDueEntryDto, FamilyFeeStructureDto, FamilyPaymentAllocationDto, FamilyPaymentDto, FamilyStudentDueDto, FeeDuesSortBy (+38 more)

### Community 3 - "School"
Cohesion: 0.05
Nodes (55): InjectRepository, AcademicYear, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn (+47 more)

### Community 4 - "auth.controller.ts"
Cohesion: 0.10
Nodes (16): mockIssuedRefreshToken, ChangePasswordDto, messagesFor(), ApiProperty, IsString, MinLength, HasEmailOrPhoneConstraint, LoginDto (+8 more)

### Community 5 - "invoices.controller.ts"
Cohesion: 0.09
Nodes (22): Header, CurrentUser, InvoicesController, toSafeInvoice(), ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags (+14 more)

### Community 6 - "payment-allocation.service.integration.spec.ts"
Cohesion: 0.05
Nodes (57): Check, FamilyStudentFeeDto, PaymentAllocation, Column, CreateDateColumn, Entity, Index, JoinColumn (+49 more)

### Community 7 - "audit.controller.ts"
Cohesion: 0.10
Nodes (20): AuditController, ApiOperation, ApiResponse, ApiTags, Controller, Get, Inject, Param (+12 more)

### Community 8 - "fees.service.integration.spec.ts"
Cohesion: 0.07
Nodes (29): AuditModule, Module, FeeStructure, Column, CreateDateColumn, DeleteDateColumn, Entity, Index (+21 more)

### Community 9 - "Student"
Cohesion: 0.11
Nodes (16): Guardian, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToMany (+8 more)

### Community 10 - "tenant-provider-config.resolver.ts"
Cohesion: 0.15
Nodes (12): ProviderNotConfiguredError, EmailOverride, MessengerOverride, ResolvedSmsConfig, SmsOverride, fakeCache(), fakeConfig(), fakeSchools() (+4 more)

### Community 11 - "tenant-settings.dto.ts"
Cohesion: 0.18
Nodes (27): CommunicationsSettingsDto, EmailSettingsDto, GreenwebSmsDto, MessengerSettingsDto, MimSmsDto, RegionAcademicYearDto, RegionAddressDto, RegionCurrencyDto (+19 more)

### Community 12 - "ClassController"
Cohesion: 0.18
Nodes (12): ClassController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Param (+4 more)

### Community 13 - "Enrollment"
Cohesion: 0.11
Nodes (18): AcademicYearStats, createStudentEnrolledIn(), EnrollmentService, Injectable, BulkRowError, ClassSectionLookup, GuardianInput, Enrollment (+10 more)

### Community 14 - "User"
Cohesion: 0.08
Nodes (30): ApiHideProperty, Optional, Inject, InjectRepository, Column, CreateDateColumn, Entity, Index (+22 more)

### Community 15 - "outbound-destination-guard.ts"
Cohesion: 0.12
Nodes (25): DestinationBlockedError, OutboundDestinationError, assertResolvesToPublicAddress(), assertSafeHttpDestination(), assertSafeSmtpDestination(), DestinationBlockedError, DestinationResolutionError, ipv4ToInt() (+17 more)

### Community 16 - "AppModule"
Cohesion: 0.16
Nodes (7): AppModule, Module, createFee(), monthOffset(), DEFAULTS, buildValidationPipeOptions(), configureApiVersioning()

### Community 17 - "all-entities.ts"
Cohesion: 0.08
Nodes (26): escapeLikePattern(), TeacherClassSection, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+18 more)

### Community 18 - "Roles"
Cohesion: 0.11
Nodes (22): GenerateFeesResultDto, toFamilyFeeStructure(), toFamilyPayment(), toFamilyStudentDue(), toFamilyStudentFee(), FeeController, ApiExtraModels, ApiOkResponse (+14 more)

### Community 19 - "http-exception.filter.ts"
Cohesion: 0.12
Nodes (16): Catch, buildErrorResponseBody(), ErrorResponseBody, resolveDetailMessage(), resolveStatus(), AllExceptionsFilter, applyRedaction(), redactPii() (+8 more)

### Community 20 - "AcademicYearController"
Cohesion: 0.09
Nodes (21): AcademicYearController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+13 more)

### Community 21 - ".testConnection"
Cohesion: 0.08
Nodes (21): IsObject, TestConnectionDto, IsIn, IsOptional, TESTABLE_MEDIA, TestableCommunicationMedium, ProviderConnectionTestController, REQUEST (+13 more)

### Community 22 - "compilerOptions"
Cohesion: 0.07
Nodes (28): multer, ../shared/dist, ../tsconfig.base.json, vitest/globals, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators (+20 more)

### Community 23 - "StudentController"
Cohesion: 0.13
Nodes (19): ApiBody, ApiConsumes, TestController, Roles(), StudentController, ApiOperation, ApiTags, Body (+11 more)

### Community 24 - "provider-connection-test.controller.ts"
Cohesion: 0.11
Nodes (26): @nestjs/swagger, ApiTenantAuth(), TestController, requestContext, paginatedSchema(), ContextGuard, resolveRole(), ROLE_PRIORITY (+18 more)

### Community 25 - "CommunicationLog"
Cohesion: 0.09
Nodes (22): CommunicationLog, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+14 more)

### Community 26 - "greenweb-sms.gateway.ts"
Cohesion: 0.18
Nodes (9): ResolvedGreenwebSmsConfig, ResolvedMimSmsConfig, normalizeBdPhoneNumber(), GreenwebSmsGateway, Injectable, MimSmsGateway, Injectable, isUnicodeMessage() (+1 more)

### Community 27 - "reminders.service.ts"
Cohesion: 0.12
Nodes (30): SkippedRecipientDto, SkippedGuardianDto, addressForMedium(), DISPATCHABLE_MEDIA, partitionByOptOut(), resolveReminderAudience(), selectReminderGuardians(), findUnsupportedPlaceholders() (+22 more)

### Community 28 - "RefreshTokenService"
Cohesion: 0.11
Nodes (16): RefreshToken, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+8 more)

### Community 29 - "communications.module.ts"
Cohesion: 0.16
Nodes (6): BatchOutcome, recordBatchOutcome(), CommunicationsProcessor, SendJobData, InjectRepository, Processor

### Community 30 - "communications.controller.ts"
Cohesion: 0.18
Nodes (7): Inject, CommunicationsService, toResponseDto(), Injectable, InjectQueue, InjectRepository, CommunicationResponseDto

### Community 31 - "CurrentTenant"
Cohesion: 0.19
Nodes (16): CurrentTenant, CommunicationsController, ApiOkResponse, ApiOperation, ApiTags, Body, Controller, Get (+8 more)

### Community 32 - "SchoolsService"
Cohesion: 0.14
Nodes (6): SchoolsService, Injectable, InjectRepository, CacheEntry, TenantSettingsCache, Injectable

### Community 33 - "SendBulkReminderDto"
Cohesion: 0.14
Nodes (13): ArrayMaxSize, ReminderBatchResponseDto, SendBulkReminderDto, ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsString (+5 more)

### Community 34 - "app.module.ts"
Cohesion: 0.08
Nodes (19): SkipThrottle, AppController, Controller, Get, FailOpenThrottlerStorage, Injectable, buildRateLimitTracker(), AcademicYearModule (+11 more)

### Community 35 - "scripts"
Cohesion: 0.09
Nodes (23): scripts, build, db:clear, db:reset, docs:generate, lint, migration:generate, migration:revert (+15 more)

### Community 37 - "schools.service.ts"
Cohesion: 0.32
Nodes (8): isPlainObject(), pickPatchShape(), redactSecretPaths(), deepMergeOmittingUnset(), isPlainObject(), mergeTenantSettings(), toPatch(), toPlainSettingsPatch()

### Community 38 - "AccessTokenDenylistService"
Cohesion: 0.10
Nodes (13): Global, AccessTokenDenylistService, Inject, Injectable, AuthModule, Module, AuthResult, LoginAttemptResult (+5 more)

### Community 39 - "@nestjs/swagger"
Cohesion: 0.18
Nodes (11): buildVersioningOptions(), buildDocsBasicAuthMiddleware(), buildDocsCspOverrideMiddleware(), safeCompare(), bootstrap(), generateOpenApiDocument(), buildSpaFallback(), SendFileCall (+3 more)

### Community 40 - "AuditService"
Cohesion: 0.08
Nodes (22): AuditService, RecordAuditEntryInput, Injectable, InjectRepository, AuditLogListResponseDto, AuditLogResponseDto, ApiProperty, AuditLog (+14 more)

### Community 41 - "EncryptionService"
Cohesion: 0.13
Nodes (18): TenantSettingsDto, EncryptionService, isEncryptedEnvelope(), Injectable, getSecretPaths(), decryptSecretFields(), encryptSecretFields(), reencryptSecretFields() (+10 more)

### Community 42 - "SendSingleReminderDto"
Cohesion: 0.13
Nodes (16): ReminderPreviewResponseDto, SendSingleReminderDto, SentReminderRecipientDto, SingleReminderResponseDto, ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty (+8 more)

### Community 43 - "AuthService"
Cohesion: 0.21
Nodes (6): Inject, AuthService, sleep(), Injectable, normalizeLoginIdentifier(), RequestContext

### Community 45 - "settings-mask.util.ts"
Cohesion: 0.28
Nodes (6): ClassRef, getNestedType(), NESTED_TYPE_METADATA_KEY, isSecretProperty(), SECRET_METADATA_KEY, ClassRef

### Community 46 - "EnrollmentController"
Cohesion: 0.11
Nodes (17): CreateEnrollmentDto, IsEnum, IsOptional, IsUUID, UpdateEnrollmentDto, EnrollmentController, ApiExtraModels, ApiOkResponse (+9 more)

### Community 47 - "schools.controller.ts"
Cohesion: 0.33
Nodes (10): MaskedCommunicationsSettingsResponseDto, MaskedEmailSettingsResponseDto, MaskedGreenwebSmsResponseDto, MaskedMessengerSettingsResponseDto, MaskedMimSmsResponseDto, MaskedSecretResponseDto, MaskedSmsSettingsResponseDto, MaskedWhatsAppSettingsResponseDto (+2 more)

### Community 48 - ".updateSettings"
Cohesion: 0.16
Nodes (13): SchoolsController, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, Body, Controller, Get (+5 more)

### Community 49 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, tsconfig-paths, @types/bcrypt, @types/express, @types/multer, @types/node, @types/passport-jwt, typescript (+9 more)

### Community 50 - "auth.service.ts"
Cohesion: 0.33
Nodes (4): fakeRepo(), patch(), REQUEST, USER

### Community 51 - "db.helper.ts"
Cohesion: 0.14
Nodes (5): createMockRequest(), createTestJwtPayload(), clearTables(), assertTestDatabaseUrl(), setupTestDatabase()

### Community 52 - "auth.module.ts"
Cohesion: 0.40
Nodes (3): RefreshTokenCleanupScheduler, Injectable, InjectQueue

### Community 53 - "classes.controller.ts"
Cohesion: 0.30
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
Cohesion: 0.22
Nodes (9): toDto(), VALIDATION_OPTIONS, TENANT_SETTINGS_SCHEMA_VERSION, REQUEST_CONTEXT, DEFAULT_REGION_SETTINGS, DEFAULT_TENANT_SETTINGS, isPlainObject(), overlayOnDefaults() (+1 more)

### Community 61 - "AppController"
Cohesion: 0.17
Nodes (26): BulkUploadErrorDto, BulkUploadRowDto, CreateGuardianDto, CreateStudentDto, QueryGuardianDto, QueryStudentDto, IsArray, IsBoolean (+18 more)

### Community 62 - "dependencies"
Cohesion: 0.29
Nodes (7): bullmq, exceljs, @nestjs/platform-express, dependencies, bullmq, exceljs, @nestjs/platform-express

### Community 63 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 64 - "single-reminder.dto.ts"
Cohesion: 0.13
Nodes (15): BulkPreviewSkippedDto, BulkPreviewStudentDto, BulkReminderPreviewResponseDto, QueryReminderBatchesDto, ReminderBatchListItemDto, ReminderBatchListResponseDto, ReminderBatchLogDto, ReminderBatchLogListResponseDto (+7 more)

### Community 65 - "FailOpenThrottlerStorage"
Cohesion: 0.19
Nodes (14): CommunicationProvider, CommunicationProviderRegistry, CommunicationSendParams, CommunicationSendResult, CommunicationProviderRegistryService, Injectable, SmtpEmailProvider, Injectable (+6 more)

### Community 66 - "tenant-provider-config.resolver.spec.ts"
Cohesion: 0.28
Nodes (14): ApiBearerAuth, ApiUnauthorizedResponse, AuthController, ApiForbiddenResponse, ApiOperation, ApiTags, Body, Controller (+6 more)

### Community 67 - "spa-fallback.spec.ts"
Cohesion: 0.12
Nodes (17): JoinTable, InjectRepository, Student, Column, CreateDateColumn, DeleteDateColumn, Entity, Index (+9 more)

### Community 69 - "reminders.service.spec.ts"
Cohesion: 0.18
Nodes (12): SanitizeAllowlist(), SanitizeText(), shared, AllowlistDto, { sanitizeAllowlist, sanitizeStrict }, StrictDto, IsBoolean, IsDateString (+4 more)

### Community 71 - "package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 72 - "rate-limit-tracker.ts"
Cohesion: 0.24
Nodes (6): ResolvedMessengerConfig, ResolvedWhatsAppConfig, ConnectionTestResult, isValidGraphApiId(), isValidGraphApiVersion(), mapMetaGraphError()

### Community 85 - "single-reminder.service.spec.ts"
Cohesion: 0.18
Nodes (17): CreateInvoiceDto, LineItemDto, QueryInvoiceDto, ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt (+9 more)

### Community 86 - "payment-allocation.e2e-spec.ts"
Cohesion: 0.21
Nodes (5): AuditInterceptor, RequestWithTenant, Injectable, Audited(), AuditedMetadata

### Community 87 - "validation-pipe.spec.ts"
Cohesion: 0.50
Nodes (3): TestDto, IsInt, IsString

### Community 118 - "typescript"
Cohesion: 0.22
Nodes (10): QueryLastRemindersDto, SendCommunicationDto, ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString (+2 more)

### Community 119 - "vitest"
Cohesion: 0.36
Nodes (4): isOriginAllowed(), requestOrigin(), SameOriginGuard, Injectable

### Community 123 - "ClassService"
Cohesion: 0.32
Nodes (3): Inject, ClassService, Injectable

### Community 124 - "smtp-email.provider.ts"
Cohesion: 0.39
Nodes (6): ResolvedEmailConfig, isSmtpConnectionError(), mapSmtpError(), SMTP_CONNECTION_ERROR_CODES, withPinnedAddressFallback(), SafeSmtpDestination

### Community 125 - "route-guard-coverage.e2e-spec.ts"
Cohesion: 0.29
Nodes (4): ALLOWLIST, AllowlistEntry, findAllowlistEntry(), JWT_AUTH_GUARD

### Community 126 - "CreateAcademicYearDto"
Cohesion: 0.29
Nodes (7): CreateAcademicYearDto, IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, Validate

### Community 128 - "redact.util.ts"
Cohesion: 0.70
Nodes (3): redact(), redactSensitiveFields(), SENSITIVE_KEYS

## Knowledge Gaps
- **194 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `name` (+189 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **53 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Roles()` connect `StudentController` to `Teacher`, `invoices.controller.ts`, `audit.controller.ts`, `ClassController`, `EnrollmentController`, `.updateSettings`, `Roles`, `AcademicYearController`, `.testConnection`, `provider-connection-test.controller.ts`, `CurrentTenant`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `CurrentTenant` connect `CurrentTenant` to `Teacher`, `invoices.controller.ts`, `audit.controller.ts`, `ClassController`, `EnrollmentController`, `.updateSettings`, `Roles`, `AcademicYearController`, `.testConnection`, `StudentController`, `provider-connection-test.controller.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `User` connect `User` to `Teacher`, `app.module.ts`, `School`, `spa-fallback.spec.ts`, `AccessTokenDenylistService`, `payment-allocation.service.integration.spec.ts`, `AuditService`, `fees.service.integration.spec.ts`, `Student`, `AuthService`, `Enrollment`, `AppModule`, `all-entities.ts`, `provider-connection-test.controller.ts`, `CommunicationLog`, `RefreshTokenService`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `Student` (e.g. with `createStudentEnrolledIn()` and `.syncStudentPlacement()`) actually correct?**
  _`Student` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `School` (e.g. with `seedReferenceData()` and `seedReferenceData()`) actually correct?**
  _`School` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `User` (e.g. with `createTeacherOnSection()` and `seedReferenceData()`) actually correct?**
  _`User` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _194 weakly-connected nodes found - possible documentation gaps or missing edges._