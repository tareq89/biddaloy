# Graph Report - biddaloy  (2026-08-22)

## Corpus Check
- 727 files · ~334,283 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4303 nodes · 10179 edges · 253 communities (184 shown, 69 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 167 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0a7d2356`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Server
- Ui Components
- Server Modules Fees
- Server Modules Users
- Server Modules Fees
- Server Modules Fees
- Ui
- Ui Menu
- Package
- Ui Factories
- Ui Api
- Ui Msw Handlers
- Server Modules Students
- Client Admin Pages Settings
- Ui I18n
- Server Modules Users
- Ui Components
- Ui Hooks
- Ui Dialog
- Ui Select
- Ui Dropdown Menu
- Ui Form Field
- Server Communications Worker
- Client Admin Package
- Server Auth Decorators
- Server Schools Settings
- Docs 01 Domain Model
- Server Modules Students
- Server Communications Testing
- Server Outbound Destination Guard
- Server Modules Auth
- Ui Schools
- Client Admin Routetree.gen
- Shared Enums
- Server
- Server Modules Invoices
- Server Modules Audit
- Server Common Rate Limit
- Server Modules Communications
- Knip
- Server Classes.service
- Server Providers Sms
- Ui Package
- Ui Package
- Server Common Decorators
- Server Modules Communications
- Server Communications Config
- Server Schools Settings
- Client Admin Tsconfig
- Server Tenant Settings.dto
- Package
- Server Classes.controller
- Server Schools Settings
- Server Reminders.service
- Server Modules Audit
- Server Modules Enrollments
- Ui Status Badge
- Server Package
- Ui Combobox
- Server Modules Academics
- Server Modules Academics
- Server Students.dto
- Server Package
- Ui Use List Url State
- Ui Form Shell
- Client Admin
- Server Modules Communications
- Server Modules Communications
- Server Fee Dues.service
- Server Modules Schools
- Server Schools Settings
- Shared Tenant Settings.types
- Ui Tooltip
- Ui Form Shell
- Ui Invoices
- Ui Students
- Client Admin Package
- Shared Package
- Ui Components
- Server Refresh Token.service
- Server Modules Communications
- Server Fees Entities
- Server Bulk Upload.service
- Ui Package
- Ui Check I18n Keys
- Ui Data Table
- Ui Classes
- Server Modules Auth
- NOTES
- Ui Wizard Shell
- Ui Radio
- Ui Detail Shell
- Client Student Package
- Ui Placeholder
- Server Modules Auth
- Server Login Attempt.service
- Server Invoices Dto
- Tsconfig.base
- Ui Component Boundary
- Package
- Server Tsconfig
- Server Communications Config
- Ui CONTRIBUTING
- Ui Check Contrast
- Ui File Upload
- Ui Toast
- Ui Eslint Config
- Server Auth.service
- Package
- Server Schools Settings
- Shared Tsconfig
- Ui Package
- Ui Api
- Ui Keyboard
- Ui Checkbox
- Ui Data Table
- Ui Academic Years
- SKILL
- Client Admin Package
- Server Config
- Server Tsconfig.lint
- Server Audit.interceptor
- Server Login.dto
- main.ts
- Server School Settings Response.dto
- Ui Pagination
- Docs Architecture
- db.helper.ts
- Server Modules Auth
- Ui Communications
- tenant-bar.stories.tsx
- money-input.stories.tsx
- Client Student
- Ui Tsconfig
- Ui Error State
- Ui List Shell
- Client Admin Mockserviceworker
- Client Student Mockserviceworker
- Client Student Tsconfig
- Tsconfig.frontend
- .prettierrc
- Server Tsconfig
- Ci Audit
- Server Same Origin.guard
- auth.controller.spec.ts
- Ui Data Fetching
- Ui Financial Mutation
- Ui Logical Properties
- Ui Use Wizard Shell Step
- Ui Mockserviceworker
- Server Package
- Client Admin Login
- Server
- Server Academics Dto
- Server Smtp Email.provider
- Server Route Guard Coverage.e2e Spec
- Ui Check Exports
- AppModule
- single-reminder.service.spec.ts
- Client Admin
- Tsconfig
- Server Nest Cli
- Server Tsconfig.build
- Ui Tsconfig
- Server Tenant Provider Config.resolver.spec
- Server Tsconfig.lint
- Shared Sanitize
- Ui Check Api Types
- Ui Sync Design Css
- Ui Schema.d
- Ui Render With Providers
- Vitest.config
- Ui Component Boundary.spec
- SmsProviderIsConfiguredConstraint
- SKILL
- Ui Tsconfig
- Docs 08 Security
- Lint Staged Eslint
- package.json
- Server Schools.controller.spec
- Client Admin Check Route Chunks
- Root
- Server Package
- Server 1784175065078 Initialschema
- Server 1784175065079 Multitenantauth
- Server 1784175065080 Addtenantisolationandenrollments
- Server 1785304003457 Addtenantidtocommunicationlogs
- Server 1785316147772 Addreminderbatchtenantandloglink
- Server 1785702546209 Addloginfailedauditaction
- Server 1785740608549 Addrefreshtokens
- Server 1785749259955 Addtenantidtoauditlogs
- Server 1786097609707 Addsettingschangeauditaction
- Server 1786642308000 Addsettingstestauditaction
- Server Refresh Token.service.spec
- start.sh
- Client Admin Tsconfig
- Dependabot
- cookie-parser
- Start
- Server Context.guard
- Server Normalize Identifier
- Server Connection Test Result.dto
- Server School List Item.dto
- Server Db Clear
- Server Package
- Server Package
- Server Package
- Docs 03 Backend Modules
- Docs 06 Frontend Architecture
- Docs 08 Security
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Generate Dummy Cert
- Reload Loop
- Server Package
- Server Package
- Server Package
- Server Package
- Server Package
- Build All
- Open Coverage Report
- Ui Main
- AGENTS
- Client Admin Vite Env.d
- .coderabbit
- Docs 06 Frontend Architecture
- Codeql
- Lint Staged.config
- Playwright.config
- Playwright Report
- Radix Ui
- Community 256

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 78 edges
2. `Student` - 78 edges
3. `CurrentTenant` - 75 edges
4. `School` - 71 edges
5. `ClassSection` - 66 edges
6. `User` - 65 edges
7. `cn()` - 63 edges
8. `Class` - 60 edges
9. `AcademicYear` - 59 edges
10. `Guardian` - 39 edges

## Surprising Connections (you probably didn't know these)
- `useUpdateSchoolSettings()` --indirect_call--> `settings()`  [INFERRED]
  ui/src/hooks/school-settings.ts → server/src/modules/schools/settings/tenant-settings-cache.service.spec.ts
- `Multi-Tenancy Rules (Biddaloy)` --references--> `apiClient`  [EXTRACTED]
  .claude/skills/multi-tenancy/SKILL.md → ui/src/api/client.ts
- `apiClient axios instance (X-Tenant-ID, X-Role, 401 refresh)` --shares_data_with--> `Multi-Tenancy Rules (Biddaloy)`  [INFERRED]
  ui/README.md → .claude/skills/multi-tenancy/SKILL.md
- `client-admin index.html` --semantically_similar_to--> `client-student index.html`  [INFERRED] [semantically similar]
  client-admin/index.html → client-student/index.html
- `Serena Project Config` --conceptually_related_to--> `Biddaloy CLAUDE.md`  [AMBIGUOUS]
  .serena/project.yml → CLAUDE.md

## Import Cycles
- 1-file cycle: `ui/eslint.config.mjs -> ui/eslint.config.mjs`

## Hyperedges (group relationships)
- **Caveman Mode Documentation Set** — claude_skills_caveman_readme, claude_skills_caveman_skill, claude_skills_caveman_readme_caveman_mode [EXTRACTED 1.00]
- **Communication Channels Implementing CommunicationProvider** — docs_architecture_05_communications_sms, docs_architecture_05_communications_whatsapp, docs_architecture_05_communications_messenger, docs_architecture_05_communications_email, docs_architecture_05_communications_provider_adapter [EXTRACTED 1.00]
- **Fee Generation to Payment to Invoice Lifecycle** — docs_architecture_01_domain_model_feestructure, docs_architecture_01_domain_model_studentfee, docs_architecture_01_domain_model_payment, docs_architecture_01_domain_model_paymentallocation, docs_architecture_01_domain_model_invoice [EXTRACTED 1.00]
- **Login & Session Security Layers** — docs_architecture_08_security_login_lockout, docs_architecture_08_security_refresh_token_rotation, docs_architecture_08_security_access_token_denylist, docs_architecture_08_security_csrf_posture, docs_architecture_08_security_same_origin_guard, docs_architecture_08_security_audit_trail [EXTRACTED 1.00]
- **Design-System Wrapper Boundary Pattern** — ui_contributing_wrapperrule, ui_src_primitives_readme_doc, ui_readme_doc, ui_contributing_threefile_requirement [INFERRED 0.85]
- **Multi-Tenant Scoping Enforced Across Stack** — claude_skills_multi_tenancy_skill_doc, server_claude_testingstandards, ui_readme_apiclient, ui_readme_hooks [INFERRED 0.85]

## Communities (253 total, 69 thin omitted)

### Community 0 - "Server"
Cohesion: 0.17
Nodes (11): supertest, AppModule, Module, extractRefreshCookie(), extractSetCookieHeaders(), createFee(), monthOffset(), DEFAULTS (+3 more)

### Community 1 - "Ui Components"
Cohesion: 0.11
Nodes (32): CreateFeeStructureDto, CreatePaymentDto, FeeDuesSortBy, GenerateStudentFeesDto, PaymentAllocationInputDto, QueryFeeDuesDto, QueryFeeStructureDto, QueryFlaggedDuesDto (+24 more)

### Community 2 - "Server Modules Fees"
Cohesion: 0.06
Nodes (61): AcademicYear, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+53 more)

### Community 3 - "Server Modules Users"
Cohesion: 0.05
Nodes (66): Check, JoinTable, PaymentAllocation, Column, CreateDateColumn, Entity, Index, JoinColumn (+58 more)

### Community 4 - "Server Modules Fees"
Cohesion: 0.04
Nodes (70): ApiHideProperty, buildRateLimitTracker(), AcademicYearModule, Module, TeacherClassSection, Column, CreateDateColumn, Entity (+62 more)

### Community 5 - "Server Modules Fees"
Cohesion: 0.10
Nodes (48): SelectSchoolPage(), UserRole, JwtMembership, JwtPayload, LoginResponse, clearAuthState(), currentSessionGeneration(), getAccessToken() (+40 more)

### Community 6 - "Ui"
Cohesion: 0.16
Nodes (16): ApiBearerAuth, ApiUnauthorizedResponse, Res, AuthController, mockIssuedRefreshToken, ApiOperation, ApiTags, Body (+8 more)

### Community 7 - "Ui Menu"
Cohesion: 0.33
Nodes (16): academicYearFactory(), classFactory(), classSectionFactory(), SECTION_NAMES, FACTORIES, FACTORY_REFERENCE_DATE, faker, resetFactorySeed() (+8 more)

### Community 8 - "Package"
Cohesion: 0.07
Nodes (39): adminOwnSchool, CONFIGURED_EMAIL, twoSchools, routeTree, schools, PaymentForm(), useCreatePayment(), mockOnlineStatus() (+31 more)

### Community 9 - "Ui Factories"
Cohesion: 0.06
Nodes (62): GlobalSearchLauncher(), SecretFieldProps, SchoolSettingsPage(), EmailSectionProps, MessengerSectionProps, RegionalSectionProps, SmsSectionProps, WhatsAppSectionProps (+54 more)

### Community 10 - "Ui Api"
Cohesion: 0.07
Nodes (34): Combobox(), ComboboxOption, ComboboxProps, CLASS_OPTIONS, Default, Empty, meta, NoResults (+26 more)

### Community 11 - "Ui Msw Handlers"
Cohesion: 0.09
Nodes (43): DialogClose(), DialogFooter(), DialogHeader(), InputProps, LOCALE_LABELS, LocaleSwitcher(), LocaleSwitcherProps, Menu() (+35 more)

### Community 12 - "Server Modules Students"
Cohesion: 0.07
Nodes (28): Invoice, Payment, create, fixtures, getOne, invoiceDefaultHandlers, invoiceHandlers, list (+20 more)

### Community 13 - "Client Admin Pages Settings"
Cohesion: 0.14
Nodes (20): createI18nInstance(), i18n, whenReady(), DocumentLocaleSync(), I18nProvider(), I18nProviderProps, clearPersistedLocale(), getPersistedLocale() (+12 more)

### Community 14 - "Ui I18n"
Cohesion: 0.08
Nodes (32): Permission, ROLE_PERMISSIONS, subscribeAuthState(), AppShell(), AppShellNavGroup, AppShellNavItem, AppShellProps, NavContent() (+24 more)

### Community 15 - "Server Modules Users"
Cohesion: 0.09
Nodes (29): ClassController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+21 more)

### Community 16 - "Ui Components"
Cohesion: 0.16
Nodes (22): TeacherListResponseDto, TeacherResponseDto, ApiProperty, ApiProperty, UserResponseDto, CreateTeacherDto, CreateUserDto, QueryTeacherDto (+14 more)

### Community 17 - "Ui Hooks"
Cohesion: 0.12
Nodes (24): @nestjs/swagger, ApiTenantAuth(), TestController, requestContext, AuditLogListResponseDto, AuditLogResponseDto, ApiProperty, CurrentUser (+16 more)

### Community 18 - "Ui Dialog"
Cohesion: 0.06
Nodes (38): DataTable(), DataTableColumn, DataTableProps, DataTableSort, readPersistedState(), COLUMNS, Default, Empty (+30 more)

### Community 19 - "Ui Select"
Cohesion: 0.09
Nodes (31): CurrentTenant, TestController, Roles(), GenerateFeesResultDto, FeeController, ApiOperation, ApiTags, Body (+23 more)

### Community 20 - "Ui Dropdown Menu"
Cohesion: 0.05
Nodes (40): compilerOptions, jsx, lib, noEmit, outDir, paths, rootDir, extends (+32 more)

### Community 21 - "Ui Form Field"
Cohesion: 0.11
Nodes (17): ApiBody, ApiConsumes, StudentController, ApiOperation, ApiTags, Body, Controller, Delete (+9 more)

### Community 22 - "Server Communications Worker"
Cohesion: 0.05
Nodes (37): Default, meta, RightToLeft, Story, Default, Disabled, Empty, InvalidValue (+29 more)

### Community 23 - "Client Admin Package"
Cohesion: 0.14
Nodes (33): ConnectionTestResultMessage(), ConnectionTestResultMessageProps, MutationErrorMessage(), SecretField(), EmailConfig, EmailFormValues, emailSchema, EmailSection() (+25 more)

### Community 24 - "Server Auth Decorators"
Cohesion: 0.05
Nodes (44): Dialog(), DialogCloseProps, DialogContent(), DialogContentProps, DialogDescription(), DialogDescriptionProps, DialogFooterProps, DialogHeaderProps (+36 more)

### Community 25 - "Server Schools Settings"
Cohesion: 0.17
Nodes (18): AuditAction, CommunicationTrigger, FeeApplicability, FeeStatus, FeeType, InvoiceStatus, PaymentAllocationType, PaymentMethod (+10 more)

### Community 26 - "Docs 01 Domain Model"
Cohesion: 0.08
Nodes (25): axe-core, eslint-config-prettier, @eslint/js, eslint-plugin-jsx-a11y, eslint-plugin-react-hooks, eslint-plugin-unused-imports, lint-staged, devDependencies (+17 more)

### Community 27 - "Server Modules Students"
Cohesion: 0.05
Nodes (37): axios, clsx, i18next, i18next-resources-to-backend, lucide-react, radix-ui, react-i18next, react-router (+29 more)

### Community 28 - "Server Communications Testing"
Cohesion: 0.05
Nodes (37): axios-mock-adapter, msw, msw-storybook-addon, storybook, @storybook/addon-a11y, @storybook/addon-essentials, @storybook/addon-interactions, @storybook/blocks (+29 more)

### Community 29 - "Server Outbound Destination Guard"
Cohesion: 0.06
Nodes (31): entry, ignoreDependencies, project, ignoreDependencies, ignoreIssues, ui/eslint-config.mjs, ui/tailwind.preset.ts, ignoreWorkspaces (+23 more)

### Community 30 - "Server Modules Auth"
Cohesion: 0.18
Nodes (11): EncryptionService, isEncryptedEnvelope(), Injectable, decryptSecretFields(), encryptSecretFields(), reencryptSecretFields(), resolveParent(), transformAtPaths() (+3 more)

### Community 31 - "Ui Schools"
Cohesion: 0.11
Nodes (36): AcademicYear, AuditLog, Class, ClassSection, CommunicationLog, Enrollment, FeeStructure, FeeStructureStudent (+28 more)

### Community 32 - "Client Admin Routetree.gen"
Cohesion: 0.14
Nodes (18): ResolvedGreenwebSmsConfig, CommunicationSendResult, ConnectionTestResult, assertSafeHttpDestination(), PinnedAddress, SafeHttpDestination, normalizeBdPhoneNumber(), createPinnedLookup() (+10 more)

### Community 33 - "Shared Enums"
Cohesion: 0.12
Nodes (21): CommunicationStatus, EnrollmentStatus, ReminderBatchStatus, COMMUNICATION_STATUS_TONE, ENROLLMENT_STATUS_TONE, FEE_STATUS_TONE, humanize(), INVOICE_STATUS_TONE (+13 more)

### Community 34 - "Server"
Cohesion: 0.11
Nodes (21): FormControl(), FormDescription(), FormField(), FormFieldContext, FormFieldContextValue, FormItem(), FormItemContext, FormItemContextValue (+13 more)

### Community 35 - "Server Modules Invoices"
Cohesion: 0.08
Nodes (41): SanitizeAllowlist(), SanitizeText(), shared, AllowlistDto, { sanitizeAllowlist, sanitizeStrict }, StrictDto, IsBeforeConstraint, ValidatorConstraint (+33 more)

### Community 36 - "Server Modules Audit"
Cohesion: 0.06
Nodes (33): bcrypt, bullmq, class-transformer, class-validator, exceljs, helmet, @nest-lab/throttler-storage-redis, @nestjs/bullmq (+25 more)

### Community 37 - "Server Common Rate Limit"
Cohesion: 0.09
Nodes (23): queryClient, Register, router, @tanstack/react-router, captureRouteError(), initSentry(), InitSentryOptions, redactBreadcrumb() (+15 more)

### Community 38 - "Server Modules Communications"
Cohesion: 0.15
Nodes (14): Route, StudentsListPage(), studentsSearchSchema, Placeholder(), Default, LocaleSample(), LocaleTextExpansion, meta (+6 more)

### Community 39 - "Knip"
Cohesion: 0.21
Nodes (5): AuditInterceptor, RequestWithTenant, Injectable, Audited(), AuditedMetadata

### Community 40 - "Server Classes.service"
Cohesion: 0.12
Nodes (23): ResolvedEmailConfig, isSmtpConnectionError(), mapSmtpError(), SMTP_CONNECTION_ERROR_CODES, SmtpEmailProvider, DestinationBlockedError, OutboundDestinationError, Injectable (+15 more)

### Community 41 - "Server Providers Sms"
Cohesion: 0.06
Nodes (31): @nestjs/cli, @nestjs/testing, devDependencies, @nestjs/cli, @nestjs/testing, supertest, ts-node, tsconfig-paths (+23 more)

### Community 42 - "Ui Package"
Cohesion: 0.05
Nodes (58): ArrayMaxSize, AuditService, RecordAuditEntryInput, Injectable, Inject, ReminderBatchResponseDto, SendBulkReminderDto, SkippedRecipientDto (+50 more)

### Community 43 - "Ui Package"
Cohesion: 0.12
Nodes (16): Catch, buildErrorResponseBody(), ErrorResponseBody, resolveDetailMessage(), resolveStatus(), AllExceptionsFilter, applyRedaction(), redactPii() (+8 more)

### Community 44 - "Server Common Decorators"
Cohesion: 0.07
Nodes (34): Header, CreateInvoiceDto, LineItemDto, QueryInvoiceDto, ArrayMinSize, IsArray, IsDateString, IsEnum (+26 more)

### Community 45 - "Server Modules Communications"
Cohesion: 0.08
Nodes (33): Select(), SelectContent(), SelectContentProps, SelectGroup(), SelectGroupProps, SelectItem(), SelectItemProps, SelectLabel() (+25 more)

### Community 46 - "Server Communications Config"
Cohesion: 0.10
Nodes (25): collectErrorPaths(), RHF_ERROR_METADATA_KEYS, FormSection(), FormSectionProps, FormShell(), FormShellError, FormShellProps, AdmissionFormWithAutosave() (+17 more)

### Community 47 - "Server Schools Settings"
Cohesion: 0.10
Nodes (12): RootLayout(), RouterContext, focusAnchorMemory, blankRoute, detailRoute, listRoute, otherListRoute, RootLayout() (+4 more)

### Community 48 - "Client Admin Tsconfig"
Cohesion: 0.08
Nodes (21): IsObject, TestConnectionDto, IsIn, IsOptional, TESTABLE_MEDIA, TestableCommunicationMedium, ProviderConnectionTestController, REQUEST (+13 more)

### Community 49 - "Server Tenant Settings.dto"
Cohesion: 0.07
Nodes (28): multer, ../shared/dist, vitest/globals, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, ignoreDeprecations (+20 more)

### Community 50 - "Package"
Cohesion: 0.06
Nodes (29): AcademicYearController, ApiOperation, ApiTags, Body, Controller, Delete, Get, Inject (+21 more)

### Community 51 - "Server Classes.controller"
Cohesion: 0.04
Nodes (53): CommunicationsService, toResponseDto(), Injectable, InjectQueue, InjectRepository, CommunicationResponseDto, CommunicationLog, Column (+45 more)

### Community 52 - "Server Schools Settings"
Cohesion: 0.11
Nodes (12): CommunicationProvider, CommunicationProviderRegistry, CommunicationProviderRegistryService, Injectable, Injectable, WhatsAppCloudProvider, BatchOutcome, recordBatchOutcome() (+4 more)

### Community 53 - "Server Reminders.service"
Cohesion: 0.18
Nodes (27): CommunicationsSettingsDto, EmailSettingsDto, GreenwebSmsDto, MessengerSettingsDto, MimSmsDto, RegionAcademicYearDto, RegionAddressDto, RegionCurrencyDto (+19 more)

### Community 54 - "Server Modules Audit"
Cohesion: 0.15
Nodes (14): EmailOverride, MessengerOverride, ResolvedMimSmsConfig, ResolvedSmsConfig, SmsOverride, TenantProviderConfigResolver, Injectable, WhatsAppOverride (+6 more)

### Community 55 - "Server Modules Enrollments"
Cohesion: 0.08
Nodes (23): FeeStructure, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+15 more)

### Community 56 - "Ui Status Badge"
Cohesion: 0.20
Nodes (21): CommunicationMedium, BD_MOBILE_PREFIXES, BN_DISTRICTS, BN_FEMALE_FIRST_NAMES, BN_LAST_NAMES, BN_MALE_FIRST_NAMES, bnAddress(), bnFullName() (+13 more)

### Community 57 - "Server Package"
Cohesion: 0.18
Nodes (12): DEFAULT_REGION, defaultSettings(), getSettings, getStoredSettings(), mergeAndMask(), schoolList, schoolsDefaultHandlers, schoolSettingsStore (+4 more)

### Community 58 - "Ui Combobox"
Cohesion: 0.12
Nodes (20): Calendar(), CalendarProps, DatePicker(), DatePickerProps, daysInMonth(), sameDay(), Default, Empty (+12 more)

### Community 59 - "Server Modules Academics"
Cohesion: 0.08
Nodes (24): scripts, api:types, build:all, build:client-admin, build:server, build:shared, build:ui, coverage (+16 more)

### Community 60 - "Server Modules Academics"
Cohesion: 0.17
Nodes (11): AcademicYear, academicYearDefaultHandlers, academicYearHandlers, create, fixtures, getOne, list, listEmpty (+3 more)

### Community 61 - "Server Students.dto"
Cohesion: 0.20
Nodes (8): Default, meta, RightToLeft, SingleMembership, singleSchool, Story, SwitchMenuOpen, twoSchools

### Community 62 - "Server Package"
Cohesion: 0.17
Nodes (9): ProviderNotConfiguredError, ResolvedMessengerConfig, ResolvedWhatsAppConfig, CommunicationSendParams, MessengerProvider, Injectable, isValidGraphApiId(), isValidGraphApiVersion() (+1 more)

### Community 63 - "Ui Use List Url State"
Cohesion: 0.15
Nodes (10): encryptionServiceFactory(), buildEncryptionKey(), buildPreviousEncryptionKeys(), decodeKey(), VALID_KEY, WRONG_LENGTH_KEY, CacheEntry, settings() (+2 more)

### Community 64 - "Ui Form Shell"
Cohesion: 0.28
Nodes (6): RouteAnnouncer(), RouteAnnouncerProps, Default, Empty, meta, Story

### Community 65 - "Client Admin"
Cohesion: 0.04
Nodes (47): Route, buildLoginError(), LoginPage(), loginSearchSchema, Route, Route, Route, Route (+39 more)

### Community 66 - "Server Modules Communications"
Cohesion: 0.08
Nodes (23): scripts, tailwind.preset.ts, vite/client, compilerOptions, baseUrl, declaration, declarationMap, ignoreDeprecations (+15 more)

### Community 67 - "Server Modules Communications"
Cohesion: 0.24
Nodes (9): BulkUploadHeader, BulkUploadParseError, cellToString(), getExtension(), isRowBlank(), loadWorksheet(), parseSpreadsheet(), REQUIRED_HEADERS (+1 more)

### Community 68 - "Server Fee Dues.service"
Cohesion: 0.12
Nodes (19): formatValidPhone(), PhoneInput(), PhoneInputProps, Default, Disabled, Empty, Invalid, meta (+11 more)

### Community 69 - "Server Modules Schools"
Cohesion: 0.12
Nodes (21): getActiveRole(), getActiveTenant(), clearNotifications(), getNotifications(), getUnreadNotificationCount(), lastSeenTenantId, listeners, markAllNotificationsRead() (+13 more)

### Community 70 - "Server Schools Settings"
Cohesion: 0.11
Nodes (23): client-admin index.html, client-admin/src/main.tsx entry point, client-admin/src/routes/__root.tsx beforeLoad session guard, client-student index.html, client-student/src/main.tsx entry point, Accessibility expectations (color-alone rule, icon-only aria-label), Contributing to @biddaloy/ui, i18n rules for literal strings and lint enforcement (+15 more)

### Community 71 - "Shared Tenant Settings.types"
Cohesion: 0.18
Nodes (8): buildDocsBasicAuthMiddleware(), buildDocsCspOverrideMiddleware(), safeCompare(), bootstrap(), buildHelmetOptions(), createApp(), buildSpaFallback(), SendFileCall

### Community 72 - "Ui Tooltip"
Cohesion: 0.09
Nodes (22): scripts, build, db:clear, db:reset, docs:generate, lint, migration:generate, migration:revert (+14 more)

### Community 73 - "Ui Form Shell"
Cohesion: 0.10
Nodes (18): AuditController, ApiOperation, ApiResponse, ApiTags, Controller, Get, Inject, Query (+10 more)

### Community 74 - "Ui Invoices"
Cohesion: 0.11
Nodes (16): CreateEnrollmentDto, IsEnum, IsOptional, IsUUID, UpdateEnrollmentDto, EnrollmentController, ApiTags, Body (+8 more)

### Community 75 - "Ui Students"
Cohesion: 0.11
Nodes (21): useSearchNavigate(), RequireRole(), RequireRoleProps, forbiddenRoute, reportsRoute, rootRoute, routeTree, studentsRoute (+13 more)

### Community 76 - "Client Admin Package"
Cohesion: 0.60
Nodes (4): GUARDIAN_ROLES, isGuardianRole(), isStaffRole(), STAFF_ROLES

### Community 77 - "Shared Package"
Cohesion: 0.10
Nodes (20): CommunicationsSettings, CurrencyGrouping, CurrencyPosition, EmailSettings, GreenwebSmsSettings, MessengerSettings, MimSmsSettings, NumeralSystem (+12 more)

### Community 78 - "Ui Components"
Cohesion: 0.15
Nodes (16): Default, meta, RightToLeft, Story, Tooltip(), TooltipContent(), TooltipContentProps, TooltipProps (+8 more)

### Community 79 - "Server Refresh Token.service"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+11 more)

### Community 80 - "Server Modules Communications"
Cohesion: 0.16
Nodes (13): checkIntlConstructor(), DEEP_IMPORT_PATTERNS, isStaticTemplateLiteral(), isStringLiteral(), noDeepUiImport, noHardcodedJsxText, noRadixImport, noRawIntl (+5 more)

### Community 81 - "Server Fees Entities"
Cohesion: 0.08
Nodes (31): Label(), LabelProps, Skeleton(), Default, meta, RowOfFields, Story, Checkbox() (+23 more)

### Community 82 - "Server Bulk Upload.service"
Cohesion: 0.14
Nodes (5): createMockRequest(), createTestJwtPayload(), clearTables(), assertTestDatabaseUrl(), setupTestDatabase()

### Community 83 - "Ui Package"
Cohesion: 0.09
Nodes (21): DetailShell(), DetailShellAction, DetailShellTab, CachedTabState, DeepLinkedTab, Default, meta, PermissionGated (+13 more)

### Community 84 - "Ui Check I18n Keys"
Cohesion: 0.11
Nodes (19): @biddaloy/ui, dependencies, @biddaloy/shared, @biddaloy/ui, @hookform/resolvers, react, react-dom, react-hook-form (+11 more)

### Community 86 - "Ui Classes"
Cohesion: 0.18
Nodes (14): extractCallSites(), flattenKeys(), loadNamespaces(), main(), pkgRoot, PLURAL_SUFFIXES, relativeTo(), repoRoot (+6 more)

### Community 87 - "Server Modules Auth"
Cohesion: 0.22
Nodes (7): Default, Disabled, Empty, Invalid, meta, RightToLeft, Story

### Community 88 - "NOTES"
Cohesion: 0.22
Nodes (11): MoneyInput(), formatCurrency(), parseCurrency(), renderDigits(), toLatinDigits(), groupDigits(), groupLakhCrore(), groupThousand() (+3 more)

### Community 89 - "Ui Wizard Shell"
Cohesion: 0.10
Nodes (21): client-admin/src/routes/login.tsx placeholder login route, design-sync conventions: styling idiom, I18nProvider wrapping requirement, StatusBadge five-tone status vocabulary, styles.css compiled stylesheet as source of truth, cfg.cssEntry scratch copy of compiled CSS, Dialog/Menu/Tooltip set to cardMode: single, design-sync notes — @biddaloy/ui → Claude Design (+13 more)

### Community 90 - "Ui Radio"
Cohesion: 0.40
Nodes (5): formatViolations(), JSDOM_AXE_OPTIONS, Matchers, toHaveNoViolations(), vitest

### Community 91 - "Ui Detail Shell"
Cohesion: 0.16
Nodes (13): SchoolsController, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, Body, Controller, Get (+5 more)

### Community 92 - "Client Student Package"
Cohesion: 0.15
Nodes (12): DeepLinkedStep, Default, InvalidFirstStep, meta, ResultScreen, RightToLeft, STEP_IDS, Story (+4 more)

### Community 93 - "Ui Placeholder"
Cohesion: 0.12
Nodes (16): RadioGroup(), RadioGroupItem(), RadioGroupItemProps, RadioGroupProps, Default, Disabled, Invalid, meta (+8 more)

### Community 94 - "Server Modules Auth"
Cohesion: 0.12
Nodes (17): devDependencies, rollup-plugin-visualizer, tailwindcss, @tanstack/react-query-devtools, @tanstack/router-plugin, @types/react, @types/react-dom, typescript (+9 more)

### Community 95 - "Server Login Attempt.service"
Cohesion: 0.12
Nodes (16): sanitize-html, dependencies, sanitize-html, devDependencies, @types/sanitize-html, typescript, typescript, main (+8 more)

### Community 96 - "Server Invoices Dto"
Cohesion: 0.21
Nodes (12): CommunicationsController, ApiOperation, ApiTags, Body, Controller, Get, HttpCode, Param (+4 more)

### Community 97 - "Tsconfig.base"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution (+8 more)

### Community 98 - "Ui Component Boundary"
Cohesion: 0.12
Nodes (16): Class, ClassSection, classDefaultHandlers, classHandlers, create, createSection, fixtures, getOne (+8 more)

### Community 99 - "Package"
Cohesion: 0.28
Nodes (16): Biddaloy CLAUDE.md, Documentation Style Guidelines, RTK (Rust Token Killer), Overview, Domain Model, Auth & Multi-Tenancy, Backend Modules, Fees, Payments & Invoices (+8 more)

### Community 100 - "Server Tsconfig"
Cohesion: 0.31
Nodes (4): Inject, AuthService, Injectable, RequestContext

### Community 101 - "Server Communications Config"
Cohesion: 0.17
Nodes (8): Global, AuthModule, Module, RefreshTokenCleanupProcessor, Processor, RefreshTokenCleanupScheduler, Injectable, InjectQueue

### Community 102 - "Ui CONTRIBUTING"
Cohesion: 0.13
Nodes (14): server, msw, workerDirectory, name, private, resolutions, js-yaml, version (+6 more)

### Community 103 - "Ui Check Contrast"
Cohesion: 0.22
Nodes (9): toDto(), VALIDATION_OPTIONS, TENANT_SETTINGS_SCHEMA_VERSION, REQUEST_CONTEXT, DEFAULT_REGION_SETTINGS, DEFAULT_TENANT_SETTINGS, isPlainObject(), overlayOnDefaults() (+1 more)

### Community 104 - "Ui File Upload"
Cohesion: 0.14
Nodes (11): contrastRatio(), css, cssPath, darkBody, errors, pkgRoot, relativeLuminance(), reverseLookup (+3 more)

### Community 105 - "Ui Toast"
Cohesion: 0.16
Nodes (10): FileUpload(), FileUploadItem, FileUploadProps, Default, Empty, ErrorState, Loading, meta (+2 more)

### Community 106 - "Ui Eslint Config"
Cohesion: 0.14
Nodes (8): Optional, AccessTokenDenylistService, Inject, Injectable, Inject, InjectRepository, JwtStrategy, Injectable

### Community 107 - "Server Auth.service"
Cohesion: 0.18
Nodes (13): AuditEntry, auditEntryFactory(), MoneyDigits, School, Teacher, teacherFactory(), User, userResponseFactory() (+5 more)

### Community 108 - "Package"
Cohesion: 0.12
Nodes (14): RefreshToken, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+6 more)

### Community 109 - "Server Schools Settings"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 110 - "Shared Tsconfig"
Cohesion: 0.14
Nodes (13): compilerOptions, rootDir, exclude, extends, include, dist, node_modules, src (+5 more)

### Community 111 - "Ui Package"
Cohesion: 0.14
Nodes (13): compilerOptions, composite, declaration, declarationMap, ignoreDeprecations, module, moduleResolution, outDir (+5 more)

### Community 112 - "Ui Api"
Cohesion: 0.12
Nodes (18): Multi-Tenancy Rules (Biddaloy), The One Rule: No Automatic Tenant Filter, PR Fix skill, --force-with-lease over --force rationale, code-review skill, Coverage targets by layer, Mandatory test scenarios (Tenant Isolation, Soft Deletes, Role Guards, Context Header), NestJS Testing Standards (+10 more)

### Community 113 - "Ui Keyboard"
Cohesion: 0.15
Nodes (12): Student, bulkUpload, bulkUploadWithErrors, create, fixtures, getOne, list, listEmpty (+4 more)

### Community 114 - "Ui Checkbox"
Cohesion: 0.18
Nodes (8): HasEmailOrPhoneConstraint, LoginDto, IsEmail, IsOptional, IsString, MinLength, Validate, ValidatorConstraint

### Community 115 - "Ui Data Table"
Cohesion: 0.21
Nodes (6): fakeRepo(), patch(), REQUEST, USER, SchoolsService, Injectable

### Community 116 - "Ui Academic Years"
Cohesion: 0.34
Nodes (9): TenantSettingsDto, isPlainObject(), pickPatchShape(), redactSecretPaths(), deepMergeOmittingUnset(), isPlainObject(), mergeTenantSettings(), toPatch() (+1 more)

### Community 117 - "SKILL"
Cohesion: 0.15
Nodes (13): exports, ./api, ./components, ./eslint-config, ./hooks, ./i18n, ./mocks, ./routes (+5 more)

### Community 118 - "Client Admin Package"
Cohesion: 0.29
Nodes (8): ActivationKey, BUTTON_KEYS, describeElement(), expectKeyboardOperable(), expectTabOrder(), KEY_SEQUENCE, KeyboardOptions, LINK_KEYS

### Community 119 - "Server Config"
Cohesion: 0.18
Nodes (10): Checkbox(), CheckboxProps, Checked, Default, Disabled, Indeterminate, Invalid, meta (+2 more)

### Community 120 - "Server Tsconfig.lint"
Cohesion: 0.20
Nodes (10): EnvironmentVariables, NODE_ENVS, validConfig, IsIn, IsNotEmpty, IsOptional, IsString, Matches (+2 more)

### Community 122 - "Server Login.dto"
Cohesion: 0.20
Nodes (9): Pagination(), PaginationProps, Default, Empty, FirstPage, LastPage, meta, RightToLeft (+1 more)

### Community 123 - "main.ts"
Cohesion: 0.45
Nodes (5): buildVersioningOptions(), generateOpenApiDocument(), buildSwaggerDocumentConfig(), createApp(), shouldMountDocs()

### Community 124 - "Server School Settings Response.dto"
Cohesion: 0.40
Nodes (5): DueEntry, GuardianContact, OPEN_STATUSES, StudentDueAggregate, StudentDueSummary

### Community 125 - "Ui Pagination"
Cohesion: 0.33
Nodes (10): MaskedCommunicationsSettingsResponseDto, MaskedEmailSettingsResponseDto, MaskedGreenwebSmsResponseDto, MaskedMessengerSettingsResponseDto, MaskedMimSmsResponseDto, MaskedSecretResponseDto, MaskedSmsSettingsResponseDto, MaskedWhatsAppSettingsResponseDto (+2 more)

### Community 126 - "Docs Architecture"
Cohesion: 0.18
Nodes (11): scripts, api:types, build-storybook, check:api-types, check:contrast, check:exports, check:i18n, design-sync:css (+3 more)

### Community 127 - "db.helper.ts"
Cohesion: 0.18
Nodes (10): UserResponseDto, create, fixtures, getOne, list, listEmpty, remove, update (+2 more)

### Community 129 - "Ui Communications"
Cohesion: 0.20
Nodes (9): InjectRepository, AuditLog, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne (+1 more)

### Community 131 - "tenant-bar.stories.tsx"
Cohesion: 0.10
Nodes (19): ButtonBaseProps, ButtonProps, Default, Disabled, Error, IconOnly, Loading, meta (+11 more)

### Community 132 - "money-input.stories.tsx"
Cohesion: 0.20
Nodes (9): Guardian, create, fixtures, guardianDefaultHandlers, guardianHandlers, list, listEmpty, remove (+1 more)

### Community 133 - "Client Student"
Cohesion: 0.20
Nodes (9): Communication, communicationDefaultHandlers, communicationHandlers, getBulkReminder, getOne, previewReminder, send, sendBulkReminder (+1 more)

### Community 134 - "Ui Tsconfig"
Cohesion: 0.20
Nodes (9): biddaloyPreset, brand, CONTRAST_PAIRS, dark, light, neutral, radius, status (+1 more)

### Community 135 - "Ui Error State"
Cohesion: 0.25
Nodes (5): eslint, eslint, componentBoundaryConfig, here, lintFixture()

### Community 136 - "Ui List Shell"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 138 - "Client Admin Mockserviceworker"
Cohesion: 0.22
Nodes (8): advisories, ALLOWLIST, expired, result, seen, { spawnSync }, today, unallowed

### Community 139 - "Client Student Mockserviceworker"
Cohesion: 0.18
Nodes (7): AuthResult, sleep(), LoginAttemptResult, normalizeLoginIdentifier(), IssuedRefreshToken, RefreshTokenReuseDetectedException, RotateResult

### Community 140 - "Client Student Tsconfig"
Cohesion: 0.17
Nodes (12): ClassRef, getNestedType(), NESTED_TYPE_METADATA_KEY, isSecretProperty(), SECRET_METADATA_KEY, ClassRef, getSecretPaths(), isPlainObject() (+4 more)

### Community 141 - "Tsconfig.frontend"
Cohesion: 0.36
Nodes (4): isOriginAllowed(), requestOrigin(), SameOriginGuard, Injectable

### Community 142 - ".prettierrc"
Cohesion: 0.22
Nodes (8): compilerOptions, exactOptionalPropertyTypes, noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, strict, extends, ./tsconfig.base.json

### Community 143 - "Server Tsconfig"
Cohesion: 0.31
Nodes (7): EFFECT_HOOK_NAMES, findNetworkCall(), getEffectHookName(), isNetworkCallCallee(), noFetchInEffect, ruleTester, walk()

### Community 144 - "Ci Audit"
Cohesion: 0.31
Nodes (6): findGuardedEndpointLiteral(), GUARDED_ENDPOINT_PATTERNS, matchesGuardedEndpoint(), noOptimisticFinancialMutation, ruleTester, walk()

### Community 145 - "Server Same Origin.guard"
Cohesion: 0.22
Nodes (6): CLASS_ATTRIBUTE_NAMES, INSET_REPLACEMENT, noPhysicalDirectionClasses, SPACING_REPLACEMENT, ruleTester, TEXT_ALIGN_REPLACEMENT

### Community 146 - "auth.controller.spec.ts"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 147 - "Ui Data Fetching"
Cohesion: 0.25
Nodes (7): compilerOptions, types, extends, include, ../tsconfig.base.json, node, **/*.ts

### Community 148 - "Ui Financial Mutation"
Cohesion: 0.25
Nodes (7): plugins, printWidth, semi, singleQuote, tailwindStylesheet, trailingComma, prettier-plugin-tailwindcss

### Community 149 - "Ui Logical Properties"
Cohesion: 0.29
Nodes (5): AppController, Controller, Get, SkipThrottle, Version

### Community 151 - "Ui Mockserviceworker"
Cohesion: 0.25
Nodes (3): ALLOWLIST, AllowlistEntry, JWT_AUTH_GUARD

### Community 152 - "Server Package"
Cohesion: 0.25
Nodes (7): description, main, name, private, type, types, version

### Community 153 - "Client Admin Login"
Cohesion: 0.25
Nodes (7): entries, errors, exported, pkg, pkgRoot, PRIVATE_DIRS, srcDir

### Community 155 - "Server Academics Dto"
Cohesion: 0.29
Nodes (7): scripts, build, build:analyze, check:route-chunks, dev, lint, preview

### Community 157 - "Server Route Guard Coverage.e2e Spec"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 158 - "Ui Check Exports"
Cohesion: 0.52
Nodes (5): biddaloyReactConfig, dataFetchingGuardConfig, financialMutationGuardConfig, noWindowAlertConfig, typeCheckedTestOverrides

### Community 159 - "AppModule"
Cohesion: 0.29
Nodes (3): BANNED_NAMES, noWindowAlert, ruleTester

### Community 161 - "Client Admin"
Cohesion: 0.70
Nodes (3): redact(), redactSensitiveFields(), SENSITIVE_KEYS

### Community 162 - "Tsconfig"
Cohesion: 0.53
Nodes (4): fakeCache(), fakeConfig(), fakeSchools(), resolverWith()

### Community 163 - "Server Nest Cli"
Cohesion: 0.53
Nodes (5): decodeResidualEntitiesForPlainText(), normalize(), RESIDUAL_ENTITIES, sanitizeAllowlist(), sanitizeStrict()

### Community 164 - "Server Tsconfig.build"
Cohesion: 0.33
Nodes (5): checkedIn, fresh, openapiJson, pkgRoot, tmpDir

### Community 165 - "Ui Tsconfig"
Cohesion: 0.33
Nodes (5): assetsDir, dest, matches, pkgRoot, repoRoot

### Community 166 - "Server Tenant Provider Config.resolver.spec"
Cohesion: 0.33
Nodes (5): components, $defs, operations, paths, webhooks

### Community 168 - "Shared Sanitize"
Cohesion: 0.33
Nodes (3): coverage, testSetupFile, uiAlias

### Community 169 - "Ui Check Api Types"
Cohesion: 0.70
Nodes (5): Caveman Skill README, Caveman Mode (compressed communication), Caveman SKILL.md Instructions, Auto-Clarity Rule, Caveman Intensity Levels (lite/full/ultra/wenyan)

### Community 170 - "Ui Sync Design Css"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 171 - "Ui Schema.d"
Cohesion: 0.40
Nodes (5): Access Token Denylist, Audit Trail, Column-Level Encryption (Deferred), Login Brute-Force Protection, Refresh Token Rotation & Reuse Detection

### Community 172 - "Ui Render With Providers"
Cohesion: 0.40
Nodes (4): ESLINT_PACKAGES, eslintBin, filesByPackage, repoRoot

### Community 173 - "Vitest.config"
Cohesion: 0.24
Nodes (13): SettingsRoute(), CurrencyGrouping, LOCALE_REGION_DEFAULTS, NumeralSystem, RegionConfigContext, RegionConfigProvider(), CurrencySymbol(), Numerals() (+5 more)

### Community 174 - "Ui Component Boundary.spec"
Cohesion: 0.07
Nodes (28): FeeStructure, StudentFee, worker, wsPassthrough, create, Enrollment, enrollmentDefaultHandlers, enrollmentHandlers (+20 more)

### Community 177 - "Ui Tsconfig"
Cohesion: 0.40
Nodes (3): EXPECTED_ROUTE_CHUNKS, outDir, projectRoot

### Community 178 - "Docs 08 Security"
Cohesion: 0.50
Nodes (4): Docker Compose Services, Docker Compose Topology, CI Pipeline, knip Dead-Code Detection

### Community 180 - "package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 194 - "Server 1786642308000 Addsettingstestauditaction"
Cohesion: 0.67
Nodes (3): ContextGuard, Role-Based Access Control (RBAC), Tenant Header Contract (@ApiTenantAuth)

### Community 195 - "Server Refresh Token.service.spec"
Cohesion: 0.67
Nodes (3): Dependabot config, npm minor-and-patch update group, PR #59 (nodemailer major bump)

### Community 208 - "Server Connection Test Result.dto"
Cohesion: 0.50
Nodes (3): TestDto, IsInt, IsString

### Community 209 - "Server School List Item.dto"
Cohesion: 0.50
Nodes (3): jsxRuleTester, ruleTester, typedRuleTester

## Ambiguous Edges - Review These
- `Serena Project Config` → `Biddaloy CLAUDE.md`  [AMBIGUOUS]
  .serena/project.yml · relation: conceptually_related_to

## Knowledge Gaps
- **1075 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `prettier-plugin-tailwindcss` (+1070 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **69 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Serena Project Config` and `Biddaloy CLAUDE.md`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useListUrlState()` connect `Ui Students` to `Ui Eslint Config`, `Ui Dialog`, `Server Modules Communications`?**
  _High betweenness centrality (0.142) - this node is a cross-community bridge._
- **Why does `AccessTokenDenylistService` connect `Ui Eslint Config` to `Client Student Mockserviceworker`, `Server Communications Config`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `settings()` connect `Ui Use List Url State` to `Client Admin Package`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `School` (e.g. with `seedReferenceData()` and `seedReferenceData()`) actually correct?**
  _`School` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `ClassSection` (e.g. with `seedReferenceData()` and `seedReferenceData()`) actually correct?**
  _`ClassSection` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _1075 weakly-connected nodes found - possible documentation gaps or missing edges._