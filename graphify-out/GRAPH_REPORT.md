# Graph Report - .  (2026-08-12)

## Corpus Check
- Large corpus: 559 files · ~253,560 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3536 nodes · 7838 edges · 197 communities (146 shown, 51 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 175 edges (avg confidence: 0.8)
- Token cost: 104,799 input · 0 output

## Community Hubs (Navigation)
- Date Picker Component
- App Module & Rate Limiting
- Fee & Payment DTOs
- Academic Entities (Class/Fee)
- Tenant Settings DTOs
- Teacher/User Response DTOs
- E2E Test Suite
- UI Test Factories
- Academic Year Controller
- API Versioning & Errors
- Academic Year Entity
- Guardian & Bulk Upload
- Audit & Academic Factories
- Communication Provider Registry
- Shared Domain Enums
- Class Controller
- Reminder DTOs
- Tenant Auth Decorator
- Invoice DTOs
- Sanitize Text Decorator
- Client-Admin TS Config
- Client-Student TS Config
- Payment Form & Auth Tests
- Dialog Component
- Menu Component
- Select Component
- i18n Setup
- Docker Compose Services
- ESLint Component Boundary Rules
- Knip Dead-Code Config
- Button Component Stories
- UI Package Dependencies
- UI Test/Storybook Deps
- Skeleton Primitive
- Client-Admin Package Config
- Client-Student Package Config
- Payment Entity
- Server Package Dependencies
- Monorepo Implementation Plan
- Server Dev Dependencies
- Access Token Denylist
- Form Field Component
- Server TS Config
- Student/Guardian DTOs
- Root ESLint & Test Deps
- Audit Module
- Communications Module
- Payment Hooks
- Class Test Factories
- Root Build Scripts
- Enrollment DTOs & Controller
- Bulk Upload Parser
- UI README & CI Docs
- UI TS Config
- Combobox Component
- Admission Form Shell
- Refresh Token Cleanup
- API Client & Session
- Auth Controller & Login DTO
- Bulk Reminder DTO
- Login Attempt Service
- Server NPM Scripts
- Communication Log Entity
- Tenant Settings Types
- Tooltip Component
- Invoice/Payment Test Factories
- Auth Module & Refresh Token
- shadcn Components Config
- Button & Empty State
- Data Table Component
- Detail Shell
- Auth Controller Endpoints
- Communications Controller
- Auth/Tenant State Tests
- List Shell
- Form Shell Component
- App Shell Tests
- Shared Package Sanitize Dep
- Base TS Config
- Audit Log DTO
- Contrast Check Script
- File Upload Component
- Tabs & Detail Shell
- Route Guards & List Route
- Wizard Shell Step Hook
- Auth Service
- Radio Component
- Audit Interceptor
- Communications Service
- Server Build TS Config
- Server Lint TS Config
- Shared TS Config
- Academic Year Test Fixtures
- Graphify Skill Docs
- UI Package Exports Map
- Button A11y Tests
- Checkbox Component
- Data Table Stories
- Env Validation Config
- Pagination Component
- Student Test Fixtures
- Root Package Resolutions
- Academic Year Service
- Refresh Token Entity
- Placeholder Component
- Communication Test Fixtures
- Reminder Service Tests
- Tailwind Design Tokens
- Client-Admin MSW Worker
- Client-Student MSW Worker
- CI Audit Script
- Same-Origin Guard
- Frontend TS Config
- UI Check Scripts
- Storybook MSW Worker
- Prettier Config
- App Health Controller
- UI Package Metadata
- Check Exports Script
- Nest CLI Config
- Fail-Open Throttler Storage
- Audit Controller
- Shared Sanitize Utils
- Check API Types Script
- OpenAPI Schema Types
- A11y Test Matchers
- Vitest Config
- Caveman Skill
- MSW Worker Directory Config
- Lint-Staged ESLint Script
- Redact Util
- Server Package Identity
- Initial Schema Migration
- Multi-Tenant Auth Migration
- Tenant Isolation Migration
- Comm Log Tenant Migration
- Reminder Batch Migration
- Login-Failed Audit Migration
- Refresh Tokens Migration
- Audit Log Tenant Migration
- Auth Test Helpers
- Dependabot Config
- Start Script
- DB Clear Script
- BullMQ Dependency
- ESLint-Prettier Dependency
- JSX A11y ESLint Plugin
- ExcelJS Dependency
- Globals Dependency
- Husky Dependency
- JSDOM Dependency
- Lint-Staged Dependency
- Throttler Redis Storage Dep
- NestJS JWT Dependency
- NestJS Express Platform Dep
- NestJS Swagger Dependency
- NestJS Throttler Dependency
- Dummy Cert Script
- Nginx Reload Loop
- Open Package Dependency
- Knip Dependency
- Prettier Dependency
- Testing Library DOM Dep
- Testing Library React Dep
- Testing Library User-Event Dep
- Supertest Types Dep
- TypeScript-ESLint Dependency
- TS-ESLint Utils Dependency
- Unplugin-SWC Dependency
- Vitest Dependency
- Vitest-Axe Dependency
- Passport Dependency
- Passport-JWT Dependency
- Postgres Driver Dependency
- Reflect-Metadata Dependency
- Build-All Script
- Open Coverage Report Script
- React Dependency
- Vite Dependency
- Shell Stories Test
- Storybook Main Config
- Client-Admin App Shell
- Client-Student App Shell

## God Nodes (most connected - your core abstractions)
1. `Student` - 77 edges
2. `Roles()` - 71 edges
3. `CurrentTenant` - 69 edges
4. `cn()` - 59 edges
5. `ClassSection` - 56 edges
6. `User` - 56 edges
7. `School` - 52 edges
8. `Class` - 51 edges
9. `AcademicYear` - 50 edges
10. `Guardian` - 38 edges

## Surprising Connections (you probably didn't know these)
- `Serena Project Config (biddaloy)` --conceptually_related_to--> `@beton-boi/ui CONTRIBUTING Guide`  [AMBIGUOUS]
  .serena/project.yml → ui/CONTRIBUTING.md
- `beton-boi Monorepo Implementation Plan` --references--> `client-student Package README`  [INFERRED]
  .hermes/plans/2026-07-14_120000-monorepo-nestjs-vite.md → client-student/README.md
- `Playwright HTML test report (generated artifact)` --references--> `CI Job: integration (integration & e2e tests)`  [AMBIGUOUS]
  playwright-report/index.html → .github/workflows/ci.yml
- `beton-boi root README` --references--> `CodeQL workflow`  [EXTRACTED]
  README.md → .github/workflows/codeql.yml
- `beton-boi Monorepo Implementation Plan` --references--> `shared Package README`  [INFERRED]
  .hermes/plans/2026-07-14_120000-monorepo-nestjs-vite.md → shared/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **graphify Skill Reference Document Set** — hermes_skills_graphify_skill_graphify_skill, hermes_skills_graphify_references_add_watch_add_watch, hermes_skills_graphify_references_exports_exports, hermes_skills_graphify_references_extraction_spec_extraction_spec, hermes_skills_graphify_references_github_and_merge_github_and_merge, hermes_skills_graphify_references_hooks_hooks, hermes_skills_graphify_references_query_query, hermes_skills_graphify_references_transcribe_transcribe, hermes_skills_graphify_references_update_update [EXTRACTED 1.00]
- **README Security section defense-in-depth layers** — readme_login_brute_force_protection, readme_session_token_lifecycle, readme_csrf_posture, readme_audit_trail [EXTRACTED 1.00]
- **UI Package Boundary/Quality Gates Enforced Across Docs and CI** — github_workflows_ci, ui_contributing, ui_readme, ui_readme_check_exports_script [INFERRED 0.85]
- **CI Pipeline Job Stages** — github_workflows_ci, github_workflows_ci_verify_job, github_workflows_ci_integration_job, github_workflows_ci_audit_job [EXTRACTED 1.00]
- **Caveman Mode Documentation Set** — claude_skills_caveman_readme, claude_skills_caveman_skill, claude_skills_caveman_readme_caveman_mode [EXTRACTED 1.00]

## Communities (197 total, 51 thin omitted)

### Community 0 - "Date Picker Component"
Cohesion: 0.06
Nodes (55): Calendar(), CalendarProps, DatePicker(), DatePickerProps, daysInMonth(), sameDay(), Default, Empty (+47 more)

### Community 1 - "App Module & Rate Limiting"
Cohesion: 0.05
Nodes (61): ApiHideProperty, buildRateLimitTracker(), AcademicYearModule, Module, TeacherClassSection, Column, CreateDateColumn, Entity (+53 more)

### Community 2 - "Fee & Payment DTOs"
Cohesion: 0.05
Nodes (52): CreateFeeStructureDto, CreatePaymentDto, FeeDuesSortBy, GenerateFeesResultDto, GenerateStudentFeesDto, PaymentAllocationInputDto, QueryFeeDuesDto, QueryFeeStructureDto (+44 more)

### Community 3 - "Academic Entities (Class/Fee)"
Cohesion: 0.08
Nodes (42): Check, FeeStructure, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn (+34 more)

### Community 4 - "Tenant Settings DTOs"
Cohesion: 0.06
Nodes (48): CommunicationsSettingsDto, EmailSettingsDto, GreenwebSmsDto, MessengerSettingsDto, MimSmsDto, RegionAcademicYearDto, RegionAddressDto, RegionCurrencyDto (+40 more)

### Community 5 - "Teacher/User Response DTOs"
Cohesion: 0.07
Nodes (38): TeacherListResponseDto, TeacherResponseDto, ApiProperty, ApiProperty, UserResponseDto, CreateTeacherDto, CreateUserDto, QueryTeacherDto (+30 more)

### Community 6 - "E2E Test Suite"
Cohesion: 0.11
Nodes (26): supertest, AppModule, Module, extractRefreshCookie(), extractSetCookieHeaders(), createFee(), monthOffset(), DEFAULTS (+18 more)

### Community 7 - "UI Test Factories"
Cohesion: 0.05
Nodes (57): FeeStructure, feeStructureFactory(), Guardian, StudentFee, Teacher, teacherFactory(), UserResponseDto, userResponseFactory() (+49 more)

### Community 8 - "Academic Year Controller"
Cohesion: 0.07
Nodes (38): ApiBody, ApiConsumes, AcademicYearController, ApiOperation, ApiTags, Body, Controller, Delete (+30 more)

### Community 9 - "API Versioning & Errors"
Cohesion: 0.07
Nodes (31): Catch, API_VERSION, buildVersioningOptions(), buildErrorResponseBody(), ErrorResponseBody, resolveDetailMessage(), resolveStatus(), AllExceptionsFilter (+23 more)

### Community 10 - "Academic Year Entity"
Cohesion: 0.05
Nodes (48): AcademicYear, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+40 more)

### Community 11 - "Guardian & Bulk Upload"
Cohesion: 0.06
Nodes (36): JoinTable, InjectQueue, InjectRepository, InjectRepository, GuardianInput, Guardian, Column, CreateDateColumn (+28 more)

### Community 12 - "Audit & Academic Factories"
Cohesion: 0.17
Nodes (33): AuditAction, CommunicationMedium, AuditEntry, auditEntryFactory(), BD_MOBILE_PREFIXES, BN_DISTRICTS, BN_FEMALE_FIRST_NAMES, BN_LAST_NAMES (+25 more)

### Community 13 - "Communication Provider Registry"
Cohesion: 0.10
Nodes (22): COMMUNICATION_PROVIDER_REGISTRY, CommunicationProvider, CommunicationProviderRegistry, CommunicationSendParams, CommunicationSendResult, SmtpEmailProvider, Injectable, MessengerProvider (+14 more)

### Community 14 - "Shared Domain Enums"
Cohesion: 0.07
Nodes (44): CommunicationStatus, CommunicationTrigger, EnrollmentStatus, FeeApplicability, FeeStatus, FeeType, InvoiceStatus, PaymentAllocationType (+36 more)

### Community 15 - "Class Controller"
Cohesion: 0.10
Nodes (29): ClassController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+21 more)

### Community 16 - "Reminder DTOs"
Cohesion: 0.10
Nodes (36): MAX_BULK_REMINDER_STUDENTS, SkippedRecipientDto, ReminderPreviewRecipientDto, ReminderPreviewResponseDto, SendSingleReminderDto, SentReminderRecipientDto, SingleReminderResponseDto, SkippedGuardianDto (+28 more)

### Community 17 - "Tenant Auth Decorator"
Cohesion: 0.11
Nodes (20): @nestjs/swagger, ApiTenantAuth(), TestController, AuditLogListResponseDto, AuditLogResponseDto, ApiProperty, CurrentUser, ROLES_KEY (+12 more)

### Community 18 - "Invoice DTOs"
Cohesion: 0.06
Nodes (35): Header, Audited(), CreateInvoiceDto, LineItemDto, QueryInvoiceDto, ArrayMinSize, IsArray, IsDateString (+27 more)

### Community 19 - "Sanitize Text Decorator"
Cohesion: 0.06
Nodes (33): SanitizeAllowlist(), SanitizeText(), shared, AllowlistDto, { sanitizeAllowlist, sanitizeStrict }, StrictDto, CreateAcademicYearDto, IsBeforeConstraint (+25 more)

### Community 20 - "Client-Admin TS Config"
Cohesion: 0.05
Nodes (40): compilerOptions, jsx, lib, noEmit, outDir, paths, rootDir, extends (+32 more)

### Community 21 - "Client-Student TS Config"
Cohesion: 0.05
Nodes (40): compilerOptions, jsx, lib, noEmit, outDir, paths, rootDir, extends (+32 more)

### Community 22 - "Payment Form & Auth Tests"
Cohesion: 0.09
Nodes (27): PaymentForm(), mockOnlineStatus(), resetOnlineStatus(), authHandlers, login, loginInvalidCredentials, loginResponseFactory(), logout (+19 more)

### Community 23 - "Dialog Component"
Cohesion: 0.08
Nodes (33): Dialog(), DialogClose(), DialogCloseProps, DialogContent(), DialogContentProps, DialogDescription(), DialogDescriptionProps, DialogFooter() (+25 more)

### Community 24 - "Menu Component"
Cohesion: 0.11
Nodes (35): InputProps, Menu(), MenuCheckboxItem(), MenuCheckboxItemProps, MenuContent(), MenuContentProps, MenuGroup(), MenuGroupProps (+27 more)

### Community 25 - "Select Component"
Cohesion: 0.08
Nodes (33): Select(), SelectContent(), SelectContentProps, SelectGroup(), SelectGroupProps, SelectItem(), SelectItemProps, SelectLabel() (+25 more)

### Community 26 - "i18n Setup"
Cohesion: 0.13
Nodes (20): COMMON_NAMESPACE, createI18nInstance(), i18n, whenReady(), I18nProvider(), I18nProviderProps, clearPersistedLocale(), DEFAULT_LOCALE (+12 more)

### Community 27 - "Docker Compose Services"
Cohesion: 0.07
Nodes (37): app service, cert-bootstrap service, certbot service, db service (Postgres), docker-compose.yml stack, nginx service, redis service, CodeQL workflow (+29 more)

### Community 28 - "ESLint Component Boundary Rules"
Cohesion: 0.07
Nodes (21): biddaloyReactConfig, componentBoundaryConfig, financialMutationGuardConfig, typeCheckedRules, typeCheckedTestOverrides, here, DEEP_IMPORT_PATTERNS, noDeepUiImport (+13 more)

### Community 29 - "Knip Dead-Code Config"
Cohesion: 0.06
Nodes (34): entry, ignoreDependencies, project, entry, project, ignoreDependencies, ignoreIssues, ui/eslint-config.mjs (+26 more)

### Community 30 - "Button Component Stories"
Cohesion: 0.07
Nodes (28): Default, Disabled, Error, IconOnly, Loading, meta, RightToLeft, Story (+20 more)

### Community 31 - "UI Package Dependencies"
Cohesion: 0.06
Nodes (35): axios, @beton-boi/shared, class-variance-authority, clsx, @hookform/resolvers, i18next, i18next-resources-to-backend, lucide-react (+27 more)

### Community 32 - "UI Test/Storybook Deps"
Cohesion: 0.06
Nodes (35): axios-mock-adapter, msw, msw-storybook-addon, storybook, @storybook/addon-a11y, @storybook/addon-essentials, @storybook/addon-interactions, @storybook/blocks (+27 more)

### Community 33 - "Skeleton Primitive"
Cohesion: 0.10
Nodes (25): Skeleton(), Default, meta, RowOfFields, Story, Checkbox(), DropdownMenu(), DropdownMenuCheckboxItem() (+17 more)

### Community 34 - "Client-Admin Package Config"
Cohesion: 0.06
Nodes (31): dependencies, @beton-boi/ui, react, react-dom, devDependencies, tailwindcss, @tailwindcss/vite, @types/react (+23 more)

### Community 35 - "Client-Student Package Config"
Cohesion: 0.06
Nodes (31): dependencies, react, react-dom, devDependencies, @beton-boi/ui, tailwindcss, @tailwindcss/vite, @types/react (+23 more)

### Community 36 - "Payment Entity"
Cohesion: 0.07
Nodes (27): Payment, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+19 more)

### Community 37 - "Server Package Dependencies"
Cohesion: 0.06
Nodes (31): bcrypt, class-transformer, class-validator, cookie-parser, helmet, ioredis, @nestjs/bullmq, @nestjs/common (+23 more)

### Community 38 - "Monorepo Implementation Plan"
Cohesion: 0.11
Nodes (31): client-student Package README, CodeRabbit Configuration, build-all.sh Orchestration Script, Vite Dev Proxy for HMR, beton-boi Monorepo Implementation Plan, Yarn Workspaces Monorepo Layout, AcademicYear Entity, AuditLog Entity (+23 more)

### Community 39 - "Server Dev Dependencies"
Cohesion: 0.06
Nodes (31): @nestjs/cli, @nestjs/testing, devDependencies, @nestjs/cli, @nestjs/testing, supertest, ts-node, tsconfig-paths (+23 more)

### Community 40 - "Access Token Denylist"
Cohesion: 0.12
Nodes (11): AccessTokenDenylistService, Inject, Injectable, AuthResult, ACCESS_TOKEN_TTL_MS, LoginAttemptResult, normalizeLoginIdentifier(), IssuedRefreshToken (+3 more)

### Community 41 - "Form Field Component"
Cohesion: 0.11
Nodes (21): FormControl(), FormDescription(), FormField(), FormFieldContext, FormFieldContextValue, FormItem(), FormItemContext, FormItemContextValue (+13 more)

### Community 42 - "Server TS Config"
Cohesion: 0.07
Nodes (28): multer, ../shared/dist, vitest/globals, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, ignoreDeprecations (+20 more)

### Community 43 - "Student/Guardian DTOs"
Cohesion: 0.17
Nodes (24): BD_PHONE_REGEX, BulkUploadErrorDto, BulkUploadRowDto, CreateGuardianDto, CreateStudentDto, QueryGuardianDto, QueryStudentDto, IsArray (+16 more)

### Community 44 - "Root ESLint & Test Deps"
Cohesion: 0.07
Nodes (27): axe-core, eslint, @eslint/js, eslint-plugin-import, eslint-plugin-react, eslint-plugin-react-hooks, eslint-plugin-unused-imports, @faker-js/faker (+19 more)

### Community 45 - "Audit Module"
Cohesion: 0.10
Nodes (15): AuditModule, Module, AuditService, RecordAuditEntryInput, Injectable, InjectRepository, AuditLog, Column (+7 more)

### Community 46 - "Communications Module"
Cohesion: 0.12
Nodes (11): COMMUNICATIONS_QUEUE, CommunicationsModule, Module, CommunicationProviderRegistryService, Injectable, BatchOutcome, recordBatchOutcome(), CommunicationsProcessor (+3 more)

### Community 47 - "Payment Hooks"
Cohesion: 0.20
Nodes (18): CreatePaymentInput, Payment, paymentKeys, useCreatePayment(), createEntityKeys(), EntityKeys, shouldRetryQuery(), CreateStudentInput (+10 more)

### Community 48 - "Class Test Factories"
Cohesion: 0.11
Nodes (24): Class, classFactory(), ClassSection, classSectionFactory(), classHandlers, create, createSection, fixtures (+16 more)

### Community 49 - "Root Build Scripts"
Cohesion: 0.08
Nodes (25): scripts, api:types, build:all, build:client-admin, build:client-student, build:server, build:shared, build:ui (+17 more)

### Community 50 - "Enrollment DTOs & Controller"
Cohesion: 0.11
Nodes (16): CreateEnrollmentDto, IsEnum, IsOptional, IsUUID, UpdateEnrollmentDto, EnrollmentController, ApiTags, Body (+8 more)

### Community 51 - "Bulk Upload Parser"
Cohesion: 0.13
Nodes (13): BulkUploadHeader, BulkUploadParseError, cellToString(), getExtension(), isRowBlank(), loadWorksheet(), ParsedRow, parseSpreadsheet() (+5 more)

### Community 52 - "UI README & CI Docs"
Cohesion: 0.11
Nodes (23): PR template, ui/ PR checklist section, CI Workflow (ci.yml), CI Job: audit (dependency vulnerability scan), CI Job: integration (integration & e2e tests), Dead Code Check (knip, non-blocking), CI Job: verify (build, lint, unit tests), Playwright HTML test report (generated artifact) (+15 more)

### Community 53 - "UI TS Config"
Cohesion: 0.08
Nodes (23): scripts, tailwind.preset.ts, vite/client, compilerOptions, baseUrl, declaration, declarationMap, ignoreDeprecations (+15 more)

### Community 54 - "Combobox Component"
Cohesion: 0.11
Nodes (18): Combobox(), ComboboxOption, ComboboxProps, CLASS_OPTIONS, Default, Empty, meta, NoResults (+10 more)

### Community 55 - "Admission Form Shell"
Cohesion: 0.14
Nodes (21): AdmissionForm(), AdmissionFormWithAutosave(), admissionSchema, AdmissionValues, Default, DraftRestore, ErrorSummary, meta (+13 more)

### Community 56 - "Refresh Token Cleanup"
Cohesion: 0.13
Nodes (6): RefreshTokenCleanupProcessor, Processor, hashSecret(), RefreshTokenService, safeEqualHex(), Injectable

### Community 57 - "API Client & Session"
Cohesion: 0.19
Nodes (15): getAccessToken(), getActiveRole(), getActiveTenant(), notifySessionExpired(), registerSessionExpiredHandler(), apiClient, performRefresh(), refreshAccessToken() (+7 more)

### Community 58 - "Auth Controller & Login DTO"
Cohesion: 0.13
Nodes (12): mockIssuedRefreshToken, HasEmailOrPhoneConstraint, LoginDto, IsEmail, IsOptional, IsString, MinLength, Validate (+4 more)

### Community 59 - "Bulk Reminder DTO"
Cohesion: 0.16
Nodes (13): ArrayMaxSize, ReminderBatchResponseDto, SendBulkReminderDto, ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsOptional (+5 more)

### Community 60 - "Login Attempt Service"
Cohesion: 0.13
Nodes (5): Optional, Inject, InjectRepository, LoginAttemptRedisClient, LoginAttemptService

### Community 61 - "Server NPM Scripts"
Cohesion: 0.10
Nodes (21): scripts, build, db:clear, db:reset, docs:generate, lint, migration:generate, migration:revert (+13 more)

### Community 62 - "Communication Log Entity"
Cohesion: 0.10
Nodes (20): CommunicationLog, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+12 more)

### Community 63 - "Tenant Settings Types"
Cohesion: 0.10
Nodes (20): CommunicationsSettings, CurrencyGrouping, CurrencyPosition, EmailSettings, GreenwebSmsSettings, MessengerSettings, MimSmsSettings, NumeralSystem (+12 more)

### Community 64 - "Tooltip Component"
Cohesion: 0.15
Nodes (16): Default, meta, RightToLeft, Story, Tooltip(), TooltipContent(), TooltipContentProps, TooltipProps (+8 more)

### Community 65 - "Invoice/Payment Test Factories"
Cohesion: 0.13
Nodes (19): Invoice, invoiceFactory(), Payment, paymentFactory(), create, fixtures, getOne, invoiceDefaultHandlers (+11 more)

### Community 66 - "Auth Module & Refresh Token"
Cohesion: 0.16
Nodes (12): Global, ACCESS_TOKEN_DENYLIST_REDIS, AuthModule, Module, REFRESH_TOKEN_CLEANUP_INTERVAL_MS, REFRESH_TOKEN_CLEANUP_JOB_ID, REFRESH_TOKEN_CLEANUP_QUEUE, RefreshTokenCleanupScheduler (+4 more)

### Community 67 - "shadcn Components Config"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+11 more)

### Community 68 - "Button & Empty State"
Cohesion: 0.14
Nodes (13): Button(), ButtonBaseProps, ButtonProps, EmptyState(), EmptyStateProps, Default, ErrorVariant, meta (+5 more)

### Community 69 - "Data Table Component"
Cohesion: 0.16
Nodes (12): DataTable(), DataTableColumn, DataTableProps, readPersistedState(), COLUMNS, Student, STUDENTS, ListShell() (+4 more)

### Community 70 - "Detail Shell"
Cohesion: 0.13
Nodes (15): CachedTabState, DeepLinkedTab, Default, meta, PermissionGated, RightToLeft, Story, StudentDetailPage() (+7 more)

### Community 71 - "Auth Controller Endpoints"
Cohesion: 0.26
Nodes (13): ApiBearerAuth, ApiUnauthorizedResponse, Res, AuthController, ApiOperation, ApiTags, Body, Controller (+5 more)

### Community 72 - "Communications Controller"
Cohesion: 0.21
Nodes (12): CommunicationsController, ApiOperation, ApiTags, Body, Controller, Get, HttpCode, Param (+4 more)

### Community 73 - "Auth/Tenant State Tests"
Cohesion: 0.35
Nodes (12): clearAuthState(), setAccessToken(), setActiveRole(), setActiveTenant(), switchActiveTenant(), renderHookWithProviders(), RenderHookWithProvidersOptions, cleanupTestState() (+4 more)

### Community 74 - "List Shell"
Cohesion: 0.15
Nodes (15): DataTableSort, ALL_STUDENTS, COLUMNS, Default, FilteredAndSorted, meta, Story, Student (+7 more)

### Community 75 - "Form Shell Component"
Cohesion: 0.20
Nodes (9): FormSection(), FormSectionProps, FormShell(), FormShellError, FormShellProps, WizardShell(), WizardShellBaseProps, WizardShellProps (+1 more)

### Community 76 - "App Shell Tests"
Cohesion: 0.17
Nodes (6): App(), App(), worker, wsPassthrough, enableMocking(), handlers

### Community 77 - "Shared Package Sanitize Dep"
Cohesion: 0.12
Nodes (16): sanitize-html, dependencies, sanitize-html, devDependencies, @types/sanitize-html, typescript, typescript, main (+8 more)

### Community 78 - "Base TS Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution (+8 more)

### Community 79 - "Audit Log DTO"
Cohesion: 0.13
Nodes (13): ApiOperation, ApiResponse, Get, Query, QueryAuditLogDto, IsDateString, IsEnum, IsInt (+5 more)

### Community 80 - "Contrast Check Script"
Cohesion: 0.14
Nodes (11): contrastRatio(), css, cssPath, darkBody, errors, pkgRoot, relativeLuminance(), reverseLookup (+3 more)

### Community 81 - "File Upload Component"
Cohesion: 0.16
Nodes (10): FileUpload(), FileUploadItem, FileUploadProps, Default, Empty, ErrorState, Loading, meta (+2 more)

### Community 82 - "Tabs & Detail Shell"
Cohesion: 0.20
Nodes (11): Tabs(), TabsContent(), TabsList(), tabsListVariants, TabsTrigger(), DetailShell(), DetailShellAction, DetailShellProps (+3 more)

### Community 83 - "Route Guards & List Route"
Cohesion: 0.23
Nodes (11): RequireRole(), RequireRoleProps, routes, StudentsListRoute(), ListUrlState, ListUrlStatePatch, parsePositiveInt(), RESERVED_KEYS (+3 more)

### Community 84 - "Wizard Shell Step Hook"
Cohesion: 0.16
Nodes (13): Probe(), routes, STEPS, useWizardShellStep(), DeepLinkedStep, Default, InvalidFirstStep, meta (+5 more)

### Community 85 - "Auth Service"
Cohesion: 0.28
Nodes (5): Inject, AuthService, sleep(), Injectable, RequestContext

### Community 86 - "Radio Component"
Cohesion: 0.17
Nodes (10): RadioGroup(), RadioGroupItem(), RadioGroupItemProps, RadioGroupProps, Default, Disabled, Invalid, meta (+2 more)

### Community 87 - "Audit Interceptor"
Cohesion: 0.22
Nodes (6): requestContext, AuditInterceptor, RequestWithTenant, Injectable, AUDITED_METADATA_KEY, AuditedMetadata

### Community 88 - "Communications Service"
Cohesion: 0.21
Nodes (7): Inject, CommunicationsService, toResponseDto(), Injectable, InjectQueue, InjectRepository, CommunicationResponseDto

### Community 89 - "Server Build TS Config"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 90 - "Server Lint TS Config"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 91 - "Shared TS Config"
Cohesion: 0.14
Nodes (13): compilerOptions, composite, declaration, declarationMap, ignoreDeprecations, module, moduleResolution, outDir (+5 more)

### Community 92 - "Academic Year Test Fixtures"
Cohesion: 0.19
Nodes (13): AcademicYear, academicYearFactory(), studentFeeFactory(), academicYearDefaultHandlers, academicYearHandlers, create, fixtures, getOne (+5 more)

### Community 93 - "Graphify Skill Docs"
Cohesion: 0.18
Nodes (13): AGENTS.md graphify Integration, graphify add & watch Reference, graphify Exports Reference, graphify Extraction Subagent Spec, graphify GitHub Clone & Merge Reference, graphify Commit Hook & CLAUDE.md Integration, graphify Query/Path/Explain Reference, graphify Transcribe Reference (+5 more)

### Community 94 - "UI Package Exports Map"
Cohesion: 0.15
Nodes (13): exports, ./api, ./components, ./eslint-config, ./hooks, ./i18n, ./mocks, ./routes (+5 more)

### Community 95 - "Button A11y Tests"
Cohesion: 0.29
Nodes (8): ActivationKey, BUTTON_KEYS, describeElement(), expectKeyboardOperable(), expectTabOrder(), KEY_SEQUENCE, KeyboardOptions, LINK_KEYS

### Community 96 - "Checkbox Component"
Cohesion: 0.18
Nodes (10): Checkbox(), CheckboxProps, Checked, Default, Disabled, Indeterminate, Invalid, meta (+2 more)

### Community 97 - "Data Table Stories"
Cohesion: 0.15
Nodes (11): COLUMNS, Default, Empty, ErrorState, Loading, meta, RightToLeft, Selectable (+3 more)

### Community 98 - "Env Validation Config"
Cohesion: 0.18
Nodes (10): EnvironmentVariables, NODE_ENVS, validConfig, IsIn, IsNotEmpty, IsOptional, IsString, Matches (+2 more)

### Community 99 - "Pagination Component"
Cohesion: 0.20
Nodes (9): Pagination(), PaginationProps, Default, Empty, FirstPage, LastPage, meta, RightToLeft (+1 more)

### Community 100 - "Student Test Fixtures"
Cohesion: 0.24
Nodes (11): Student, studentFactory(), bulkUpload, bulkUploadWithErrors, create, fixtures, getOne, list (+3 more)

### Community 101 - "Root Package Resolutions"
Cohesion: 0.18
Nodes (10): server, name, private, resolutions, js-yaml, version, workspaces, client-* (+2 more)

### Community 102 - "Academic Year Service"
Cohesion: 0.27
Nodes (4): Inject, AcademicYearService, Injectable, InjectRepository

### Community 103 - "Refresh Token Entity"
Cohesion: 0.18
Nodes (10): RefreshToken, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+2 more)

### Community 104 - "Placeholder Component"
Cohesion: 0.22
Nodes (7): Placeholder(), Default, LocaleTextExpansion, meta, MswBackedData, Story, StudentCount()

### Community 105 - "Communication Test Fixtures"
Cohesion: 0.22
Nodes (10): Communication, communicationFactory(), communicationDefaultHandlers, communicationHandlers, getBulkReminder, getOne, previewReminder, send (+2 more)

### Community 106 - "Reminder Service Tests"
Cohesion: 0.24
Nodes (5): SkipReason, guardian(), student(), guardian(), student()

### Community 107 - "Tailwind Design Tokens"
Cohesion: 0.20
Nodes (9): betonBoiPreset, brand, CONTRAST_PAIRS, dark, light, neutral, radius, status (+1 more)

### Community 108 - "Client-Admin MSW Worker"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 109 - "Client-Student MSW Worker"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 110 - "CI Audit Script"
Cohesion: 0.22
Nodes (8): advisories, ALLOWLIST, expired, result, seen, { spawnSync }, today, unallowed

### Community 111 - "Same-Origin Guard"
Cohesion: 0.36
Nodes (4): isOriginAllowed(), requestOrigin(), SameOriginGuard, Injectable

### Community 112 - "Frontend TS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, exactOptionalPropertyTypes, noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, strict, extends, ./tsconfig.base.json

### Community 113 - "UI Check Scripts"
Cohesion: 0.22
Nodes (9): scripts, api:types, build-storybook, check:api-types, check:contrast, check:exports, lint, storybook (+1 more)

### Community 114 - "Storybook MSW Worker"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 115 - "Prettier Config"
Cohesion: 0.25
Nodes (7): plugins, printWidth, semi, singleQuote, tailwindStylesheet, trailingComma, prettier-plugin-tailwindcss

### Community 116 - "App Health Controller"
Cohesion: 0.29
Nodes (5): AppController, Controller, Get, SkipThrottle, Version

### Community 117 - "UI Package Metadata"
Cohesion: 0.25
Nodes (7): description, main, name, private, type, types, version

### Community 118 - "Check Exports Script"
Cohesion: 0.25
Nodes (7): entries, errors, exported, pkg, pkgRoot, PRIVATE_DIRS, srcDir

### Community 119 - "Nest CLI Config"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 121 - "Audit Controller"
Cohesion: 0.33
Nodes (5): AuditController, ApiTags, Controller, Inject, UseGuards

### Community 122 - "Shared Sanitize Utils"
Cohesion: 0.53
Nodes (5): decodeResidualEntitiesForPlainText(), normalize(), RESIDUAL_ENTITIES, sanitizeAllowlist(), sanitizeStrict()

### Community 123 - "Check API Types Script"
Cohesion: 0.33
Nodes (5): checkedIn, fresh, openapiJson, pkgRoot, tmpDir

### Community 124 - "OpenAPI Schema Types"
Cohesion: 0.33
Nodes (5): components, $defs, operations, paths, webhooks

### Community 125 - "A11y Test Matchers"
Cohesion: 0.40
Nodes (5): formatViolations(), JSDOM_AXE_OPTIONS, Matchers, toHaveNoViolations(), vitest

### Community 126 - "Vitest Config"
Cohesion: 0.33
Nodes (3): coverage, testSetupFile, uiAlias

### Community 127 - "Caveman Skill"
Cohesion: 0.70
Nodes (5): Caveman Skill README, Caveman Mode (compressed communication), Caveman SKILL.md Instructions, Auto-Clarity Rule, Caveman Intensity Levels (lite/full/ultra/wenyan)

### Community 128 - "MSW Worker Directory Config"
Cohesion: 0.40
Nodes (5): msw, workerDirectory, client-admin/public, client-student/public, ui/.storybook/public

### Community 129 - "Lint-Staged ESLint Script"
Cohesion: 0.40
Nodes (4): ESLINT_PACKAGES, eslintBin, filesByPackage, repoRoot

### Community 130 - "Redact Util"
Cohesion: 0.60
Nodes (3): redact(), redactSensitiveFields(), SENSITIVE_KEYS

### Community 131 - "Server Package Identity"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 142 - "Dependabot Config"
Cohesion: 0.67
Nodes (3): Dependabot config, npm minor-and-patch update group, PR #59 (nodemailer major bump)

## Ambiguous Edges - Review These
- `Playwright HTML test report (generated artifact)` → `CI Job: integration (integration & e2e tests)`  [AMBIGUOUS]
  playwright-report/index.html · relation: references
- `Serena Project Config (biddaloy)` → `@beton-boi/ui CONTRIBUTING Guide`  [AMBIGUOUS]
  .serena/project.yml · relation: conceptually_related_to

## Knowledge Gaps
- **860 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `prettier-plugin-tailwindcss` (+855 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **51 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Playwright HTML test report (generated artifact)` and `CI Job: integration (integration & e2e tests)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Serena Project Config (biddaloy)` and `@beton-boi/ui CONTRIBUTING Guide`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useListUrlState()` connect `Route Guards & List Route` to `Access Token Denylist`, `List Shell`?**
  _High betweenness centrality (0.252) - this node is a cross-community bridge._
- **Why does `AccessTokenDenylistService` connect `Access Token Denylist` to `Auth Module & Refresh Token`, `Login Attempt Service`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Why does `User` connect `App Module & Rate Limiting` to `Auth Module & Refresh Token`, `Academic Entities (Class/Fee)`, `Payment Entity`, `Teacher/User Response DTOs`, `Refresh Token Entity`, `Access Token Denylist`, `Academic Year Entity`, `Guardian & Bulk Upload`, `Audit Module`, `Tenant Auth Decorator`, `Auth Service`, `Login Attempt Service`, `Communication Log Entity`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _860 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Date Picker Component` be split into smaller, more focused modules?**
  _Cohesion score 0.056856187290969896 - nodes in this community are weakly interconnected._